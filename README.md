# YouTube Sentiment Analyzer — Projet MLOps complet

**TP3 — Cloud Computing** · Filière INDIA · ENSAM Rabat, Université Mohammed V
Année universitaire 2026/27 · Prof. Maria Zemzami
Réalisé par **BAMOHAMED Douaa**

Système MLOps de bout en bout qui analyse en temps réel le sentiment des
commentaires d'une vidéo YouTube : extraction par une extension Chrome,
inférence par une API REST déployée dans le cloud, restitution graphique
dans le popup de l'extension.

---

## Liens du projet

| | |
|---|---|
| **Dépôt GitHub** | <https://github.com/duabamo/youtube-sentiment> |
| **API déployée** | `https://reimagined-space-umbrella-v66j497xvjrwfw4pp-7860.app.github.dev` |
| **Documentation API** | `https://reimagined-space-umbrella-v66j497xvjrwfw4pp-7860.app.github.dev/docs` |
| **Vidéo de démonstration** | fournie séparément (fichier remis avec le rendu) |

> L'API est hébergée dans un conteneur Docker tournant sur **GitHub Codespaces**.
> Hugging Face Spaces ayant restreint les Docker Spaces aux comptes PRO en cours
> de projet, la cible de déploiement a changé — voir la section 9.5 du rapport
> technique. Le `Dockerfile` et `app_api.py` sont restés identiques.
>
> Le Codespace s'arrêtant après 30 minutes d'inactivité, l'API peut nécessiter
> un redémarrage avant consultation.

---

## 1. Description du projet

### Problématique

Un créateur de contenu reçoit des centaines à des milliers de commentaires par
vidéo. Les lire un par un est chronophage, l'impression générale qu'on en
retire est subjective, et rien n'est quantifiable pour piloter une stratégie
éditoriale.

### Solution

| Composant | Technologie | Rôle |
|---|---|---|
| Frontend | Extension Chrome MV3 (JS, HTML, CSS) | Extraction des commentaires + visualisation |
| Backend | FastAPI + Uvicorn | API REST `/health` et `/predict_batch` |
| ML Engine | scikit-learn — TF-IDF + Logistic Regression | Classification en 3 classes |
| Déploiement | Docker sur GitHub Codespaces | Hébergement de l'API |
| Versioning | Git + GitHub | Code, modèle, documentation |

Labels : `-1` négatif · `0` neutre · `1` positif

---

## 2. Architecture technique

```
┌──────────────────────────────────────────────────────────────┐
│  NAVIGATEUR (Chrome)                                         │
│                                                              │
│  Page youtube.com/watch                                      │
│       │                                                      │
│       │  ① content.js : scroll progressif + lecture du DOM   │
│       ▼                                                      │
│  ┌────────────────────┐        ┌─────────────────────────┐   │
│  │  content.js        │ ──②──► │  popup.js               │   │
│  │  (content script)  │        │  (interface + graphes)  │   │
│  └────────────────────┘        └───────────┬─────────────┘   │
└────────────────────────────────────────────┼─────────────────┘
                                             │ ③ POST /predict_batch
                                             │    (lots de 100, CORS)
                                             ▼
┌──────────────────────────────────────────────────────────────┐
│  GITHUB CODESPACES — conteneur Docker (port 7860, public)    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  FastAPI (app_api.py)                                  │  │
│  │    • validation Pydantic                               │  │
│  │    • clean_text()  ← identique à l'entraînement        │  │
│  │    • pipeline sklearn chargé en mémoire au démarrage   │  │
│  │        TfidfVectorizer → LogisticRegression            │  │
│  │    • ④ prédictions + statistiques agrégées             │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                                             │ ⑤ JSON
                                             ▼
                              ⑥ popup.js : score global, donut,
                                 barre de répartition, liste filtrable
```

### Structure du dépôt

```
tp3-youtube-sentiment/
├── data/
│   ├── raw/                  reddit.csv (source immuable, non versionné)
│   └── processed/            reddit_clean.csv, train.csv, test.csv
├── models/
│   ├── sentiment_model.joblib    pipeline complet (TF-IDF + LogReg)
│   └── tfidf_vectorizer.joblib   vectoriseur seul
├── src/
│   ├── data/      download_data.py · clean_data.py · eda.py · split_data.py
│   ├── models/    train_model.py · evaluate_model.py
│   ├── api/       main.py · schemas.py · predictor.py
│   └── utils/     config.py · logger.py
├── chrome-extension/
│   ├── manifest.json
│   ├── popup.html
│   ├── css/popup.css
│   ├── js/content.js · js/popup.js
│   └── icons/
├── tests/         test_model.py · test_api.py · test_integration.py
├── reports/       metrics.json · eda_summary.json · figures/
├── deploy/        DEPLOIEMENT.md · README_SPACE.md
├── docs/          RAPPORT_TECHNIQUE.md · REPONSES_QUESTIONS.md
├── app_api.py                point d'entrée de production
├── Dockerfile
├── requirements.txt          dépendances de développement
├── requirements-prod.txt     dépendances de production
└── .gitignore · .dockerignore · pytest.ini
```

---

## 3. Installation et utilisation

> **Démarrage pas à pas sous Windows :** voir [`GUIDE_DEMARRAGE.md`](GUIDE_DEMARRAGE.md),
> qui couvre l'installation, les erreurs fréquentes et l'ordre de lancement.

### Prérequis

Python 3.10+, Git, Google Chrome.

### Mise en place

```bash
git clone https://github.com/duabamo/youtube-sentiment.git
cd tp3-youtube-sentiment

python -m venv venv
source venv/bin/activate          # Windows : venv\Scripts\activate

pip install -r requirements.txt
```

### Pipeline complet — en une commande

```bash
python run_all.py            # les 6 étapes enchaînées (~5 min)
python run_all.py --fast     # sans GridSearchCV (~1 min, modèle moins bon)
```

### Pipeline complet — étape par étape

```bash
python -m src.data.download_data     # télécharge data/raw/reddit.csv + stats
python -m src.data.clean_data        # nettoyage -> data/processed/
python -m src.data.eda               # 3 figures + eda_summary.json
python -m src.data.split_data        # split 80/20 stratifié
python -m src.models.train_model     # comparaison + GridSearchCV + .joblib
python -m src.models.evaluate_model  # matrice de confusion + metrics.json
```

> `python -m src.models.train_model --fast` saute le GridSearchCV (~2 min de moins).

### Lancer l'API en local

```bash
uvicorn src.api.main:app --reload --port 8000
```

- Documentation interactive : <http://localhost:8000/docs>
- Santé : <http://localhost:8000/health>

```bash
curl -X POST http://localhost:8000/predict_batch \
  -H "Content-Type: application/json" \
  -d '{"comments":["amazing tutorial","worst video ever"]}'
```

### Installer l'extension Chrome

1. `chrome://extensions` → activer le **Mode développeur**
2. **Charger l'extension non empaquetée** → choisir le dossier `chrome-extension/`
3. Ouvrir une vidéo YouTube, cliquer sur l'icône, puis **Analyser les commentaires**

Pour viser l'API déployée plutôt que l'API locale, modifier `API_BASE` en haut
de `chrome-extension/js/popup.js`.

### Tests

```bash
pytest                      # 46 tests (modèle, API, intégration)
pytest tests/test_model.py -v

# Vérification de l'API réellement déployée
API_URL=https://VOTRE-USER-yt-sentiment-api.hf.space python -m tests.test_integration
```

### Déploiement

Procédure complète dans
[`deploy/DEPLOIEMENT_CODESPACES.md`](deploy/DEPLOIEMENT_CODESPACES.md) :
l'image Docker est construite et exécutée **dans un GitHub Codespace**, et le
port 7860 est exposé publiquement. Aucune installation de Docker sur la machine
locale n'est nécessaire.

Hugging Face Spaces ayant restreint les Docker Spaces aux comptes PRO, la
procédure correspondante est conservée en annexe dans
[`deploy/DEPLOIEMENT.md`](deploy/DEPLOIEMENT.md).

```bash
docker build -t yt-sentiment-api .
docker run -p 7860:7860 yt-sentiment-api
```

---

## 4. Résultats

### Performances du modèle (7 178 commentaires de test)

| Métrique | Valeur | Critère de l'énoncé | Statut |
|---|---|---|---|
| Accuracy | **89,3 %** | ≥ 80 % | ✅ |
| F1-macro | **0,885** | — | ✅ |
| F1 négatif | **0,823** | > 0,75 | ✅ |
| F1 neutre | **0,930** | > 0,75 | ✅ |
| F1 positif | **0,901** | > 0,75 | ✅ |
| Latence (batch de 50) | **1,27 ms** | < 100 ms | ✅ |

### Comparaison des algorithmes

| Modèle | Accuracy | F1-macro | Temps d'entraînement |
|---|---|---|---|
| **LogisticRegression (optimisée)** | **0,893** | **0,885** | 8 s |
| LinearSVC | 0,879 | 0,868 | 3 s |
| LogisticRegression (défaut) | 0,845 | 0,835 | 6 s |
| RandomForest | 0,792 | 0,760 | 107 s |
| MultinomialNB | 0,569 | 0,456 | 2 s |

Hyperparamètres retenus par GridSearchCV (5-fold, `f1_macro`) :
`C=10.0`, `ngram_range=(1,1)`, `min_df=2` — F1-macro en validation croisée **0,873**.

### Matrice de confusion

| Vérité ↓ / Prédit → | négatif | neutre | positif |
|---|---|---|---|
| **négatif** (1 641) | **1 331** | 128 | 182 |
| **neutre** (2 398) | 29 | **2 322** | 47 |
| **positif** (3 139) | 232 | 148 | **2 759** |

### Figures

| | |
|---|---|
| `reports/figures/distribution_classes.png` | Répartition des 3 classes |
| `reports/figures/longueur_textes.png` | Longueur des commentaires par classe |
| `reports/figures/top_mots.png` | 15 mots les plus fréquents par classe |
| `reports/figures/matrice_confusion.png` | Matrice brute et normalisée |
| `reports/figures/extension_popup_light.png` | Extension — thème clair |
| `reports/figures/extension_popup_dark.png` | Extension — thème sombre |

---

## 5. Démonstration

![Extension — thème clair](reports/figures/extension_popup_light.png)

L'extension affiche le score global (−1 → +1), la répartition en pourcentage,
un graphique en anneau, et la liste des commentaires filtrables par sentiment,
chacun avec son niveau de confiance. Les boutons de pied de page copient le
résumé dans le presse-papiers ou exportent l'analyse complète en JSON.

---

## 6. Documentation complémentaire

- [`docs/RAPPORT_TECHNIQUE.md`](docs/RAPPORT_TECHNIQUE.md) — rapport technique détaillé
- [`docs/REPONSES_QUESTIONS.md`](docs/REPONSES_QUESTIONS.md) — réponses aux questions de réflexion des 6 phases
- [`deploy/DEPLOIEMENT_CODESPACES.md`](deploy/DEPLOIEMENT_CODESPACES.md) — **déploiement GitHub + Codespaces (procédure principale)**
- [`deploy/DEPLOIEMENT.md`](deploy/DEPLOIEMENT.md) — variante Hugging Face Spaces (nécessite un compte PRO)
- `reports/metrics.json` — toutes les métriques au format machine

---

## Licence

MIT — projet académique, ENSAM Rabat 2026/27.
