# =============================================================================
# PHASE 6 — Image Docker de production (Hugging Face Spaces)
#
# Bonnes pratiques appliquées :
#   1. image de base légère      : variante -slim (~45 Mo contre ~350 Mo
#                                  pour l'image python complète)
#
#      NB : l'énoncé suggère python:3.10-slim. J'utilise 3.13-slim parce que
#      scikit-learn 1.9.1 — la version qui a produit models/sentiment_model.joblib
#      — exige Python >= 3.11. Charger un modèle sérialisé avec une version
#      différente de scikit-learn donne au mieux un avertissement, au pire des
#      prédictions fausses : l'image doit donc refléter l'environnement
#      d'entraînement, pas l'inverse. Le principe (image slim) est respecté.
#   2. optimisation des layers   : requirements.txt copié AVANT le code, donc
#                                  le layer `pip install` reste en cache tant
#                                  que les dépendances ne changent pas
#   3. copie sélective           : seuls app_api.py et models/ entrent dans
#                                  l'image — pas de data/, pas de notebooks,
#                                  pas de tests
#   4. --no-cache-dir            : pip ne conserve pas les wheels téléchargés
#   5. utilisateur non-root      : exigé par Hugging Face Spaces, et bonne
#                                  pratique de sécurité
#   6. HEALTHCHECK               : l'orchestrateur sait si le conteneur est vivant
# =============================================================================

FROM python:3.13-slim

# Variables d'environnement Python
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# --- Layer 1 : dépendances (rarement modifiées -> reste en cache) ----------
COPY requirements-prod.txt .
RUN pip install --no-cache-dir -r requirements-prod.txt

# --- Layer 2 : artefacts du modèle ----------------------------------------
COPY models/sentiment_model.joblib models/sentiment_model.joblib

# --- Smoke test au BUILD : le modele doit reellement predire --------------
# Sans ce test, une incompatibilite de version entre le .joblib et la
# scikit-learn installee ne se voit qu'a l'execution : /health repond
# "healthy" (le modele se deserialise) mais /predict_batch renvoie 500.
# Ici le build echoue immediatement, avec un message explicite.
RUN python -c "\
import joblib, sklearn, sys; \
m = joblib.load('models/sentiment_model.joblib'); \
p = m.predict(['this video is great', 'this is terrible']); \
assert len(p) == 2, 'prediction invalide'; \
print('[smoke test] OK - scikit-learn', sklearn.__version__, '- predictions', list(p))"

# --- Layer 4 : code applicatif (souvent modifié -> dernier) ---------------
COPY app_api.py .

# --- Utilisateur non-root (requis par Hugging Face Spaces) ----------------
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Port standard des Spaces Hugging Face
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; \
        sys.exit(0 if urllib.request.urlopen('http://localhost:7860/health').status==200 else 1)"

CMD ["uvicorn", "app_api:app", "--host", "0.0.0.0", "--port", "7860"]
