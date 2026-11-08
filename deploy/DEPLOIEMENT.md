# Guide de déploiement — Hugging Face Spaces + GitHub

Toutes les commandes sont à lancer depuis la racine du projet.

---

## 1. Versionner le projet sur GitHub

```bash
cd tp3-youtube-sentiment

git init
git add .
git commit -m "feat: projet MLOps complet - analyse de sentiment YouTube"

# Créer d'abord un repo vide sur github.com, puis :
git remote add origin https://github.com/duabamo/youtube-sentiment.git
git branch -M main
git push -u origin main
```

> `data/` et `logs/` sont exclus par `.gitignore`.
> `models/sentiment_model.joblib` fait 0,8 Mo : il est versionné pour
> permettre le déploiement sans réentraînement.

### Commits atomiques recommandés (si vous reconstituez l'historique)

```bash
git add .gitignore requirements.txt src/utils
git commit -m "chore: structure MLOps et configuration du projet"

git add src/data
git commit -m "feat(data): pipeline de téléchargement, nettoyage, EDA et split"

git add src/models
git commit -m "feat(model): entraînement TF-IDF + LogisticRegression et évaluation"

git add src/api
git commit -m "feat(api): API FastAPI avec /health et /predict_batch"

git add chrome-extension
git commit -m "feat(extension): extension Chrome MV3 avec visualisations"

git add Dockerfile requirements-prod.txt app_api.py .dockerignore
git commit -m "feat(deploy): containerisation Docker pour Hugging Face Spaces"

git add tests
git commit -m "test: tests unitaires et d'intégration du modèle et de l'API"

git add README.md docs
git commit -m "docs: README et rapport technique"
```

---

## 2. Tester l'image Docker en local — ÉTAPE OPTIONNELLE

**Docker n'a pas besoin d'être installé sur ta machine.** C'est Hugging Face qui
construit l'image sur ses serveurs à partir du `Dockerfile` quand tu pousses le
code. Passe directement à l'étape 3.

Cette étape ne sert que si le build HF échoue plusieurs fois : tester en local
donne un retour en 30 secondes au lieu de 3 minutes par tentative.

```bash
docker build -t yt-sentiment-api .
docker run -p 7860:7860 yt-sentiment-api

# Dans un autre terminal :
curl http://localhost:7860/health
curl -X POST http://localhost:7860/predict_batch \
  -H "Content-Type: application/json" \
  -d '{"comments":["great video","terrible content"]}'
```

Vérifier la taille de l'image :

```bash
docker images yt-sentiment-api
```

---

## 3. Créer le Space Hugging Face

1. Aller sur <https://huggingface.co/new-space>
2. **Space name** : `yt-sentiment-api`
3. **License** : MIT
4. **SDK** : **Docker** → *Blank*
5. **Visibility** : Public
6. Cliquer sur *Create Space*

---

## 4. Pousser le code vers le Space

Le Space ne doit contenir **que** les fichiers nécessaires à l'exécution.

```bash
# Depuis un dossier parent, hors du repo GitHub
git clone https://huggingface.co/spaces/VOTRE-USER/yt-sentiment-api
cd yt-sentiment-api

# Copier les 4 éléments nécessaires
cp ../tp3-youtube-sentiment/app_api.py .
cp ../tp3-youtube-sentiment/Dockerfile .
cp ../tp3-youtube-sentiment/requirements-prod.txt .
mkdir -p models
cp ../tp3-youtube-sentiment/models/sentiment_model.joblib models/

# Le README du Space porte les métadonnées YAML (sdk, app_port)
cp ../tp3-youtube-sentiment/deploy/README_SPACE.md README.md

git add .
git commit -m "feat: déploiement de l'API de sentiment"
git push
```

Si Git demande une authentification : créer un token sur
<https://huggingface.co/settings/tokens> (droit **write**) et l'utiliser
comme mot de passe.

> **Fichier > 10 Mo** : passer par Git LFS
> (`git lfs install && git lfs track "*.joblib"`).
> Ici le modèle fait 0,8 Mo, donc ce n'est pas nécessaire.

---

## 5. Vérifier le déploiement

Le build prend 2 à 4 minutes (onglet *Logs* du Space).

```bash
curl https://VOTRE-USER-yt-sentiment-api.hf.space/health

curl -X POST https://VOTRE-USER-yt-sentiment-api.hf.space/predict_batch \
  -H "Content-Type: application/json" \
  -d '{"comments":["amazing tutorial, thank you","this is garbage"]}'
```

Puis lancer la suite de tests d'intégration contre l'API déployée :

```bash
cd ../tp3-youtube-sentiment
API_URL=https://VOTRE-USER-yt-sentiment-api.hf.space python -m tests.test_integration
```

---

## 6. Basculer l'extension sur l'API de production

Dans `chrome-extension/js/popup.js`, remplacer :

```js
const API_BASE = "http://localhost:8000";
```

par :

```js
const API_BASE = "https://VOTRE-USER-yt-sentiment-api.hf.space";
```

Puis recharger l'extension dans `chrome://extensions` (bouton ↻).

---

## 7. Installer l'extension dans Chrome

1. Ouvrir `chrome://extensions`
2. Activer le **Mode développeur** (interrupteur en haut à droite)
3. Cliquer sur **Charger l'extension non empaquetée**
4. Sélectionner le dossier `chrome-extension/`
5. Ouvrir une vidéo YouTube, cliquer sur l'icône de l'extension, puis sur
   *Analyser les commentaires*

Pour livrer l'extension en `.zip` :

```bash
cd chrome-extension && zip -r ../chrome-extension.zip . && cd ..
```

---

## Mise à jour du modèle en production

1. Réentraîner : `python -m src.models.train_model`
2. Incrémenter `MODEL_VERSION` dans `app_api.py` (ex. `1.1.0`)
3. Copier le nouveau `.joblib` dans le clone du Space
4. `git commit && git push` → Hugging Face rebuild automatiquement

Le champ `model_version` de `/health` permet de vérifier quelle version
est réellement en ligne.
