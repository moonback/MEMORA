# Stockage objet privé — MEMORA

MEMORA stocke les métadonnées et les autorisations dans PostgreSQL. Les octets des fichiers restent dans un bucket objet privé compatible S3, configuré dans une région de l'Union européenne.

## Configuration

Définir les variables suivantes dans le fichier local .env ou dans le gestionnaire de secrets du déploiement :

- OBJECT_STORAGE_PROVIDER : identifiant non secret du fournisseur (par défaut s3-compatible).
- OBJECT_STORAGE_ENDPOINT : endpoint HTTPS du fournisseur S3-compatible.
- OBJECT_STORAGE_REGION : région S3 utilisée pour la signature SigV4.
- OBJECT_STORAGE_BUCKET : bucket privé dédié à MEMORA.
- OBJECT_STORAGE_ACCESS_KEY_ID et OBJECT_STORAGE_SECRET_ACCESS_KEY : identifiants avec le minimum de permissions nécessaire.

Ne jamais committer les identifiants. En production, l'API refuse les endpoints HTTP. L'exemple .env.example contient des valeurs fictives uniquement.

## Flux d'upload

1. Un utilisateur authentifié et membre actif disposant du rôle owner, admin ou member crée d'abord une source dans le workspace.
2. POST /api/workspaces/:workspaceId/sources/:sourceId/object/upload-url valide le type MIME, la taille (1 octet à 100 MiB) et le SHA-256. Le serveur génère une clé opaque liée au workspace et à la source.
3. Le client téléverse directement les octets vers l'URL PUT présignée. Il doit transmettre les en-têtes retournés par l'API, notamment Content-Type et x-amz-checksum-sha256.
4. POST /api/workspaces/:workspaceId/sources/:sourceId/object/complete déclenche une vérification HEAD côté serveur. La taille, le type MIME et le checksum doivent correspondre à la demande initiale avant que l'objet passe à l'état verified.
5. GET /api/workspaces/:workspaceId/sources/:sourceId/object/download-url ne produit une URL GET présignée que pour un objet verified et un membre actif du workspace.

Les URL présignées expirent après cinq minutes. Elles sont des secrets temporaires : ne pas les journaliser, les transmettre à des tiers ou les conserver dans les événements d'audit.

## Configuration du bucket

- Désactiver l'accès public et l'hébergement de site web.
- Héberger le bucket dans une région UE et vérifier contractuellement la résidence des données, les sauvegardes et les sous-traitants du fournisseur.
- Limiter les credentials à ce bucket et aux opérations nécessaires (PUT, HEAD, GET).
- Configurer CORS pour les origines Web MEMORA autorisées, les méthodes PUT et les en-têtes Content-Type et x-amz-checksum-sha256. Ne pas utiliser une origine générique * en production.
- Activer le chiffrement au repos et la journalisation de sécurité du fournisseur sans enregistrer les URL présignées.
- Prévoir une règle de cycle de vie pour les uploads incomplets et une politique de rétention/suppression cohérente avec les demandes d'effacement.

## Limites de ce lot

- La limite applicative est de 100 MiB par objet ; l'upload multipart n'est pas encore pris en charge.
- La vérification compare la taille, le type MIME et le checksum SHA-256 renvoyés par le stockage. Le fournisseur doit exposer les checksums S3 via HeadObject (ChecksumMode ENABLED).
- Aucun antivirus, sandbox, OCR, extraction de texte ou ingestion asynchrone n'est inclus dans MEM-020.
- Les fichiers ne doivent pas être considérés comme sûrs simplement parce que leur checksum est valide. Le traitement et l'ouverture côté client devront appliquer des contrôles complémentaires.


## MEM-021 — expiration et nettoyage des uploads

Chaque objet pending possède un expires_at persistant. La durée par défaut est de 1 800 secondes, configurable avec OBJECT_UPLOAD_TTL_SECONDS (300 à 86 400 secondes), indépendamment des URL présignées (300 secondes). La finalisation réserve une lease en base, committe, exécute HeadObject hors transaction, puis finalise par compare-and-set. Aucun verrou PostgreSQL n'est conservé pendant l'appel S3. Le worker NestJS s'exécute au démarrage puis toutes les minutes. Il réserve des lots avec FOR UPDATE SKIP LOCKED, committe avant DeleteObject et reprend les leases expirées après crash. DeleteObject est idempotent ; en cas d'erreur, seul un code générique est conservé et la ligne reste pending pour retry. Les objets verified ne sont jamais candidats au nettoyage ; un trigger PostgreSQL interdit leur transition vers un autre état et la modification de leurs coordonnées.

### Permissions et limites

Limiter le rôle du bucket à PutObject, GetObject, HeadObject et DeleteObject sur le préfixe MEMORA. Le nettoyage est périodique et non temps réel. La suppression distante et la mise à jour PostgreSQL ne forment pas une transaction distribuée : les leases et l'idempotence assurent la reprise après panne. Aucun antivirus, OCR ou multipart n'est inclus.
