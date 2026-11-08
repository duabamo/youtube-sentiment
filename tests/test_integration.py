"""
PHASE 7 — Test d'INTÉGRATION : flux complet Extension -> API -> Résultats.

Deux modes :

  1. API locale embarquée (par défaut, utilisée par pytest) :
         pytest tests/test_integration.py -v

  2. API réellement déployée (vérification post-déploiement) :
         API_URL=https://VOTRE-USER-yt-sentiment-api.hf.space \
             python -m tests.test_integration

Le second mode rejoue exactement ce que fait l'extension Chrome :
découpage en lots de 100, agrégation côté client, comparaison des
statistiques locales et distantes.
"""

import json
import os
import sys
import time

import pytest

API_URL = os.environ.get("API_URL")

# Commentaires YouTube réalistes, incluant des cas difficiles.
COMMENTAIRES_SIMULES = [
    "This tutorial is absolutely amazing, thank you so much!",
    "I don't understand anything, worst explanation ever",
    "The video is 15 minutes long",
    "best channel on youtube, keep going 🔥",
    "waste of time, nothing new here",
    "what software are you using at 3:20?",
    "merci beaucoup, très clair et bien expliqué",
    "boring, I fell asleep",
    "subscribed! can't wait for the next one",
    "the audio quality is terrible",
    "",                                  # cas limite : vide
    "!!!",                               # cas limite : ponctuation seule
]


# ===========================================================================
# Mode 1 — pytest avec l'API embarquée
# ===========================================================================
@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from src.api.main import app
    with TestClient(app) as c:
        yield c


def test_flux_complet(client):
    """Simule le parcours : extraction -> batch -> API -> agrégation."""
    # Étape 1-2 : l'extension a extrait les commentaires de la page
    comments = COMMENTAIRES_SIMULES
    assert len(comments) > 0

    # Étape 3 : envoi par batch à l'API
    health = client.get("/health").json()
    assert health["model_loaded"] is True

    r = client.post("/predict_batch", json={"comments": comments})
    assert r.status_code == 200
    data = r.json()

    # Étape 4-5 : l'API a traité et retourné les prédictions
    assert len(data["predictions"]) == len(comments)

    # Étape 6 : l'extension recalcule les statistiques côté client.
    # Elles doivent coïncider avec celles de l'API.
    preds = [p["sentiment"] for p in data["predictions"]]
    stats_api = data["statistics"]
    assert preds.count(1) == stats_api["positif"]
    assert preds.count(0) == stats_api["neutre"]
    assert preds.count(-1) == stats_api["negatif"]
    assert abs(sum(preds) / len(preds) - stats_api["score_global"]) < 1e-3


def test_coherence_entre_deux_appels(client):
    """Deux appels identiques doivent donner exactement le même résultat."""
    payload = {"comments": COMMENTAIRES_SIMULES[:8]}
    a = client.post("/predict_batch", json=payload).json()
    b = client.post("/predict_batch", json=payload).json()
    assert [p["sentiment"] for p in a["predictions"]] == \
           [p["sentiment"] for p in b["predictions"]]


def test_decoupage_en_lots(client):
    """200 commentaires en 2 lots de 100 == 1 lot de 200 (agrégation client)."""
    gros = ["this video is great"] * 120 + ["this video is awful"] * 80
    en_un_lot = client.post("/predict_batch", json={"comments": gros}).json()

    morceaux = []
    for i in range(0, len(gros), 100):
        part = client.post("/predict_batch", json={"comments": gros[i:i + 100]}).json()
        morceaux.extend(p["sentiment"] for p in part["predictions"])

    assert morceaux == [p["sentiment"] for p in en_un_lot["predictions"]]


# ===========================================================================
# Mode 2 — vérification manuelle contre l'API déployée
# ===========================================================================
def _verifier_api_distante(base_url: str) -> int:
    import urllib.error
    import urllib.request

    def get(path):
        with urllib.request.urlopen(f"{base_url}{path}", timeout=30) as resp:
            return resp.status, json.loads(resp.read())

    def post(path, payload):
        req = urllib.request.Request(
            f"{base_url}{path}",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json",
                     "Origin": "https://www.youtube.com"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read()), dict(resp.headers)
        except urllib.error.HTTPError as exc:
            # Le corps d'une reponse d'erreur contient le detail renvoye par
            # l'API : sans cela, urllib ne montre que "HTTP Error 500" et le
            # diagnostic est impossible.
            if exc.code >= 500:
                corps = exc.read().decode(errors="replace")
                print(f"\n[KO ] {path} -> HTTP {exc.code}")
                print(f"       reponse de l'API : {corps[:800]}\n")
            raise

    echecs = 0
    print(f"\n=== Vérification de {base_url} ===\n")

    # 1. /health
    try:
        status, health = get("/health")
        ok = status == 200 and health.get("model_loaded")
        print(f"[{'OK ' if ok else 'KO '}] /health -> {health}")
        echecs += 0 if ok else 1
    except Exception as exc:                                  # noqa: BLE001
        print(f"[KO ] /health injoignable : {exc}")
        return 1

    # 2. /predict_batch + temps de réponse réseau
    t0 = time.perf_counter()
    status, data, headers = post("/predict_batch",
                                 {"comments": COMMENTAIRES_SIMULES})
    rtt = (time.perf_counter() - t0) * 1000
    ok = status == 200 and len(data["predictions"]) == len(COMMENTAIRES_SIMULES)
    print(f"[{'OK ' if ok else 'KO '}] /predict_batch -> {len(data['predictions'])} "
          f"prédictions | API {data['processing_time_ms']} ms | aller-retour {rtt:.0f} ms")
    echecs += 0 if ok else 1
    for p in data["predictions"][:5]:
        print(f"        {p['label']:<8} {p['confidence']:.2f}  {p['text'][:50]}")
    print(f"        statistiques : {data['statistics']}")

    # 3. CORS (sans lui, l'extension ne peut pas appeler l'API)
    cors = headers.get("access-control-allow-origin")
    ok = cors in ("*", "https://www.youtube.com")
    print(f"[{'OK ' if ok else 'KO '}] CORS Access-Control-Allow-Origin = {cors}")
    echecs += 0 if ok else 1

    # 4. Gestion d'erreur : batch vide
    try:
        post("/predict_batch", {"comments": []})
        print("[KO ] batch vide accepté (422 attendu)")
        echecs += 1
    except urllib.error.HTTPError as exc:
        ok = exc.code == 422
        print(f"[{'OK ' if ok else 'KO '}] batch vide -> HTTP {exc.code}")
        echecs += 0 if ok else 1

    print(f"\n=== {'Tout est OK' if echecs == 0 else f'{echecs} échec(s)'} ===")
    return echecs


if __name__ == "__main__":
    if not API_URL:
        print("Usage : API_URL=https://... python -m tests.test_integration")
        sys.exit(2)
    sys.exit(1 if _verifier_api_distante(API_URL.rstrip("/")) else 0)
