# Déploiement sur GitHub Codespaces

Guide principal de déploiement pour ce projet.
Hugging Face Spaces reste documenté dans `DEPLOIEMENT.md` — voir la note en fin de page.

L'API tourne **dans un conteneur Docker construit à l'intérieur du Codespace**, et
le port 7860 est exposé publiquement. L'extension Chrome l'appelle comme n'importe
quelle API cloud.

---

## 0. Pousser le projet sur GitHub

Un Codespace démarre depuis un dépôt GitHub : cette étape est obligatoire.

Crée d'abord un dépôt **vide** sur <https://github.com/new>, nommé
`tp3-youtube-sentiment`, **sans** README ni .gitignore. Puis, en local :

```powershell
cd "C:\Users\bamoh\Downloads\industrie 4.0\tp3-youtube-sentiment"
git remote add origin https://github.com/duabamo/youtube-sentiment.git
git branch -M main
git push -u origin main
```

Le dépôt contient déjà son historique de commits : pas de `git init` ni `git commit`.

---

## 1. Ouvrir le Codespace

Sur la page du dépôt : bouton vert **Code** → onglet **Codespaces** →
**Create codespace on main**.

Le fichier `.devcontainer/devcontainer.json` est détecté automatiquement. Il
installe Python 3.13, Docker, et toutes les dépendances de `requirements.txt`.
Compte **3 à 5 minutes** à la première ouverture.

> **Si le build du Codespace échoue** sur l'image Python 3.13 : ouvre
> `.devcontainer/devcontainer.json`, remplace le tag par
> `mcr.microsoft.com/devcontainers/python:1-3.12-bookworm`, commite, et relance.
> En dernier recours, supprime le dossier `.devcontainer/` : Codespaces utilise
> alors son image par défaut, qui contient déjà Python et Docker, et il suffit
> de lancer `pip install -r requirements.txt` à la main.

Tout ce qui suit s'exécute **dans le terminal du Codespace** (Linux, pas Windows).

---

## 2. Régénérer le modèle

```bash
python run_all.py
```

Environ 5 minutes. Indispensable : `data/` n'est pas versionné, et cela garantit
que le `.joblib` correspond aux versions installées dans le Codespace.

Vérifie ensuite que tout passe :

```bash
pytest
```

Attendu : **46 passed**.

---

## 3. Construire et lancer l'image Docker

C'est ici que la Phase 6 prend tout son sens : Docker est disponible dans le
Codespace, donc l'image de production est réellement construite et exécutée.

```bash
docker build -t yt-sentiment-api .
docker images yt-sentiment-api          # vérifier la taille de l'image
docker run -d -p 7860:7860 --name api yt-sentiment-api
```

Vérification locale, depuis le Codespace :

```bash
sleep 10
curl http://localhost:7860/health
curl -X POST http://localhost:7860/predict_batch \
  -H "Content-Type: application/json" \
  -d '{"comments":["amazing tutorial","worst video ever"]}'
```

Commandes utiles :

```bash
docker logs api            # voir les logs du conteneur
docker stop api            # arrêter
docker rm api              # supprimer avant de relancer un build
```

---

## 4. Rendre le port public

**C'est l'étape critique.** Par défaut, un port forwardé est *privé* : une requête
externe sans jeton GitHub reçoit une page d'authentification, et l'extension
Chrome échoue sans message clair.

```bash
gh codespace ports visibility 7860:public --codespace $CODESPACE_NAME
```

Ou via l'interface : onglet **PORTS** en bas du terminal → clic droit sur la ligne
7860 → **Port Visibility** → **Public**.

Récupère l'URL publique :

```bash
echo "https://$CODESPACE_NAME-7860.app.github.dev"
```

Teste-la depuis ton navigateur Windows, pas depuis le Codespace :

```
https://TON-CODESPACE-7860.app.github.dev/health
https://TON-CODESPACE-7860.app.github.dev/docs
```

Si tu vois une page de connexion GitHub, le port est resté privé — refais l'étape.

---

## 5. Basculer l'extension sur l'URL du Codespace

En local (Windows), dans `chrome-extension\js\popup.js`, remplace :

```js
const API_BASE = "http://localhost:8000";
```

par ton URL :

```js
const API_BASE = "https://TON-CODESPACE-7860.app.github.dev";
```

`manifest.json` autorise déjà `https://*.app.github.dev/*` dans
`host_permissions` — rien d'autre à modifier.

Puis dans `chrome://extensions`, clique sur **↻** sur la carte de l'extension,
ouvre une vidéo YouTube et lance l'analyse.

```powershell
git add chrome-extension/js/popup.js
git commit -m "chore: basculer l extension sur l API Codespaces"
git push
```

---

## 6. Validation complète

Depuis ton PC Windows, venv activé :

```powershell
$env:API_URL="https://TON-CODESPACE-7860.app.github.dev"
python -m tests.test_integration
```

Ce script vérifie `/health`, `/predict_batch`, les en-têtes CORS, la gestion
d'erreur, et mesure le temps d'aller-retour réseau.

---

## Ce qu'il faut savoir avant la soutenance

**Le Codespace s'arrête tout seul après 30 minutes d'inactivité.** L'URL cesse
alors de répondre et l'extension affiche « API injoignable ». Avant la démo :

```bash
docker start api          # si le conteneur ne s'est pas relancé
curl http://localhost:7860/health
```

et **revérifie que le port 7860 est toujours public** — la visibilité peut
revenir à privée après un redémarrage. C'est l'erreur la plus courante.

**L'URL change si tu crées un nouveau Codespace.** Elle dépend du nom du
Codespace, pas du dépôt. Garde le même Codespace entre tes tests et ta
soutenance, sinon il faut remettre à jour `API_BASE` dans `popup.js`.

**Quota gratuit : 120 heures de calcul par mois** sur un compte GitHub Free
(60 heures réelles sur une machine 2 cœurs, le multiplicateur étant de 2), plus
15 Go de stockage. Large pour ce TP, mais **arrête ton Codespace quand tu as
fini** (menu *Codespaces* → *Stop codespace*) : il consomme tant qu'il tourne.

**Différence honnête avec un vrai déploiement.** Codespaces est un environnement
de développement, pas une plateforme d'hébergement : l'API n'est joignable que
pendant que le Codespace tourne. C'est un point à assumer en soutenance plutôt
qu'à masquer — le `Dockerfile` est strictement le même que celui qui serait
poussé sur une plateforme d'hébergement, seule la cible change.

---

## Pourquoi pas Hugging Face Spaces

Hugging Face a restreint les Spaces Gradio et Docker sur CPU Basic aux comptes
**PRO** (payant). Seuls les *Static Spaces* restent gratuits, et ils ne peuvent
pas exécuter d'API Python. Le message rencontré est :

> *Static Spaces are free for everyone, but hosting Gradio and Docker Spaces on
> free cpu-basic requires a PRO subscription.*

`DEPLOIEMENT.md` conserve la procédure Hugging Face : elle reste valable avec un
compte PRO, et `deploy/README_SPACE.md` contient les métadonnées YAML du Space.
Le `Dockerfile` et `app_api.py` sont identiques dans les deux cas — c'est tout
l'intérêt de la containerisation : l'application ne dépend pas de la plateforme.
