# control-tower — documentation fonctionnelle

## Tableau de bord `/dash`

`/dash` affiche, dans un panneau de la session Claude Code, les issues suivies
du projet de la session. Les autres projets n'y figurent jamais.

### Ouvrir et fermer

- `/dash` ouvre le panneau s'il est fermé (réponse `Dashboard opened.`) et le
  ferme s'il est ouvert (réponse `Dashboard closed.`).
- Rien n'ouvre le panneau automatiquement, ni au démarrage ni à la reprise
  d'une session.
- La personne peut aussi fermer le panneau elle-même (Échap) ; le panneau cesse
  alors de se rafraîchir.
- Un panneau encore ouvert lors d'une reprise de session recommence à se
  rafraîchir ; un panneau fermé n'est jamais rouvert.

Le panneau n'offre aucune action (pas de touche ni de navigation) : il est en
lecture seule.

### Contenu

Une ligne d'en-tête `ISSUE  TITLE  STEP  NOTE  AGE`, puis une ligne par issue,
en colonnes alignées à gauche :

| Colonne | Contenu |
|---------|---------|
| ISSUE | `#` suivi du numéro |
| TITLE | titre de l'issue ; à défaut, nom de la branche |
| STEP | étape courante, suivie des marques `blocked` puis `orphan` le cas échéant |
| NOTE | raison du blocage si l'issue est bloquée ; sinon la note la plus récente de l'historique ; aucune note : `—` |
| AGE | temps passé dans l'étape courante |

- Sans aucune issue suivie : une seule ligne `No tracked issue.`, sans en-tête.
- Les textes du panneau sont en anglais.
- Le panneau tient dans sa largeur (100 colonnes par exemple) : quand la place
  manque, le titre et la note sont raccourcis et se terminent par `…`.

### Ancienneté

- Temps écoulé depuis l'entrée dans l'étape courante : plusieurs passages
  consécutifs sur la même étape (avec une note, par exemple) ne remettent pas le
  compteur à zéro ; un retour à une autre étape, si.
- Affichée avec une seule unité, arrondie à l'inférieur : `0m` (30 s), `45m`,
  `3h` (3 h 10), `2d` (2 j 5 h).

### Ordre

1. Les issues bloquées d'abord.
2. Puis l'étape la moins avancée (`spec` avant `vert`, etc.).
3. À étape égale, la plus ancienne dans son étape d'abord.
4. À égalité complète, le plus petit numéro d'abord.

### Issues masquées

Une issue `termine` depuis 7 jours (168 h) ou plus n'apparaît plus ; avant ce
seuil elle reste affichée, en fin de liste.

### Issue orpheline

Une issue qui n'est pas `termine` et dont le worktree n'existe plus porte la
marque `orphan`. Une issue `termine` n'est jamais orpheline. Si git ne peut pas
lister les worktrees, aucune issue n'est marquée orpheline.

### Rafraîchissement

Tant que le panneau est ouvert, son contenu est relu à l'ouverture puis toutes
les 60 secondes : il reflète les changements faits depuis d'autres sessions et
la suppression d'un worktree avec au plus 60 secondes de retard.

### Limites connues

- La fermeture par la personne (Échap) arrêtant le rafraîchissement n'est pas
  couverte par les tests automatiques ; elle se vérifie manuellement (fermer
  avec Échap, puis constater qu'aucun rafraîchissement n'a plus lieu).
- L'affichage dans l'onglet Code de l'application desktop n'a pas été vérifié
  visuellement par la recette.
