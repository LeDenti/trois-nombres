# Trois nombres, lecteur public (article 4 du code bonobo)

En ligne : https://ledenti.github.io/trois-nombres/fr/ (version française d'origine, sans assistant ; la version anglaise avec assistant est à la racine) (dépôt public
https://github.com/LeDenti/trois-nombres, commits signés matter-x-).
Toute modification : éditer ici puis pousser sur le dépôt.

Une page, `index.html`, sans serveur ni dépendance : elle ouvre un WebSocket
vers un nœud public XRPL et, pour une clé donnée, affiche :

- **engagements signés** : EscrowCreate réussis dont la clé est l'émetteur ;
- **tenus** : EscrowFinish réussis dont la clé est le propriétaire (Owner) ;
- **expirés** : EscrowCancel réussis dont la clé est le propriétaire.

Les tentatives refusées par la chaîne (tec…) ne comptent pas. En dessous :
escrows encore vivants sur le registre, nombre de défenseurs (SignerList),
et ce que la clé a finalisé ou annulé pour d'autres. La ligne du temps
donne date, acte, état et lien vers l'explorateur ; aucun mémo n'est lu.

Usage : ouvrir `index.html` (double-clic suffit) ou la servir n'importe où
(GitHub Pages, Render). `index.html#rADRESSE` lit directement cette clé.
Réseaux : testnet par défaut, mainnet au choix ; lecture seule, aucune clé
privée n'entre jamais dans la page.

Vérifié le 13/11/2026 sur testnet : rGJsjkfmASA2ezXYDpTQJZDp9tRgCJAPhw
(4 / 4 / 0), r9eDSQ2Cex3ahuMtwkqMyvrQBNfYEYqzWo (9 / 6 / 3),
rUuvu1XPgd5GtTgrXQKiwrHq3fb2xiHZMW (oracle : 0 / 0 / 0, 50 tenus pour
d'autres, 13 laissés expirer).

Piège : un serveur lancé depuis l'app Claude ne lit pas `~/Desktop`
(protection macOS), tester depuis une copie hors du Bureau.
