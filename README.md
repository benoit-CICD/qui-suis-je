# Qui suis-je ?

Page web qui affiche tout ce qu’un site peut savoir sur un visiteur avec JavaScript, sans cookie et sans rien lui demander.

Le site est statique (HTML, CSS et JavaScript, sans dépendance ni étape de build).

## Lancer

Certaines API (Client Hints, `navigator.storage`, DRM…) ne fonctionnent qu’en contexte sécurisé (`https://` ou `localhost`).
Il faut donc servir le dossier plutôt qu’ouvrir le fichier directement :

```bash
cd ~/Projects/git/qui-suis-je
python3 -m http.server 8765
```

Ouvrir ensuite <http://localhost:8765>.

## Ce qui est collecté

| Section | Exemples | Technique |
|---|---|---|
| Analyse & empreinte | Identifiant unique, détection VPN/proxy, fuite WebRTC, User-Agent falsifié | Recoupement des signaux |
| IP & réseau | IPv4/IPv6, FAI, ASN, IP WebRTC, débit/latence estimés | API d’IP, `RTCPeerConnection`, `navigator.connection` |
| Localisation | Pays, ville, code postal, carte, GPS (avec accord) | Géolocalisation IP, `navigator.geolocation` |
| Heure & langue | Fuseau, décalage, langues, formats | `Intl`, `navigator.languages` |
| Navigateur | Nom/version, User-Agent, DNT/GPC, plugins, bloqueur de pub, API disponibles | UA + `navigator.userAgentData` |
| Système & matériel | OS, architecture, cœurs, RAM, batterie, mini-benchmark | Client Hints, `getBattery()` |
| Écran | Résolution, DPR, barre des tâches, gamut, HDR, thème, préférences d’accessibilité | `screen`, `matchMedia` |
| Carte graphique | GPU exact, empreintes WebGL et canvas, WebGPU | WebGL `WEBGL_debug_renderer_info` |
| Audio & médias | Empreinte audio, périphériques, codecs, DRM, voix de synthèse | `OfflineAudioContext`, `enumerateDevices` |
| Polices | Polices installées (Office, Adobe…) | Mesure de texte dans un canvas |
| Stockage & autorisations | Quota (indice de navigation privée), état des permissions | `navigator.storage`, `navigator.permissions` |
| Visite en cours | Referrer, historique, type de navigation, temps passé | `performance`, `document` |
| Comportement en direct | Souris, clics, touches, défilement, changements d’onglet | Écouteurs d’événements |

Le bouton « Exporter en JSON » télécharge toutes les valeurs affichées.

## Services tiers

Tout le reste est calculé localement, mais certaines informations nécessitent des requêtes externes :

- **IP et géolocalisation** : `ipapi.co`, puis `get.geojs.io` et `ipwho.is` en secours ; `api.ipify.org` / `api6.ipify.org` pour l’IPv4 et l’IPv6 ;
- **WebRTC** : serveur STUN `stun.l.google.com` ;
- **Carte** : iframe OpenStreetMap ;
- **Détection de bloqueur** : requête « appât » vers `pagead2.googlesyndication.com` (sans cookie).

## Fichiers

- `index.html` : structure et tuiles de résumé
- `style.css` : mise en page responsive, thèmes clair et sombre
- `app.js` : collecte (une fonction `collect*` par section, sources partagées dans `src`)
