# Import de fichiers — MEM-023

## Formats et limites

La première version accepte PDF, DOCX, TXT et Markdown. La limite applicative est de 100 MiB par fichier ; les uploads multipart ne sont pas pris en charge. Les contrôles d'extension, MIME et taille du navigateur servent à guider l'utilisateur. L'API reste la frontière de validation.

## Parcours d'import

1. Le navigateur valide le nom, l'extension et la taille du fichier.
2. Le navigateur calcule SHA-256 à partir des octets du fichier.
3. L'API crée une source de type `document` dans le workspace courant avec le nom, le MIME et le checksum.
4. L'API crée une URL PUT présignée et retourne les en-têtes obligatoires. La clé objet et le bucket sont générés/conservés côté serveur.
5. Le navigateur envoie directement le fichier au stockage objet privé avec XMLHttpRequest pour suivre la progression.
6. L'API finalise l'upload et vérifie via HeadObject la taille, le type MIME et le checksum.
7. La bibliothèque recharge la source. Le document reste en état `pending` jusqu'à l'orchestration d'ingestion ; un checksum vérifié ne signifie pas que le document a été analysé ou rendu inoffensif.

## Progression, annulation et reprise

La progression est calculée à partir de l'événement upload de XMLHttpRequest. L'annulation interrompt le transfert navigateur ; tout objet incomplet est ensuite candidat au nettoyage automatique après expiration. En cas d'erreur réseau après l'obtention de l'URL, l'interface permet de réessayer le PUT avec la même URL temporaire. Une URL expirée nécessite un nouveau parcours d'import.

Si la création de source réussit mais que l'initialisation de l'URL échoue, la source peut rester en attente sans objet. Elle n'est pas considérée comme téléversée ; la gestion des reprises et des statuts sera consolidée dans le workflow d'ingestion.

## Sécurité et configuration

- Les endpoints existants appliquent authentification, membership active et rôles owner/admin/member.
- Les URLs signées expirent rapidement et ne sont ni enregistrées dans la base ni journalisées.
- Le navigateur ne reçoit jamais les credentials S3, bucket ou clé objet.
- Le stockage doit être privé, hébergé dans l'UE et configuré avec CORS limité aux origines MEMORA autorisées.
- Autoriser les méthodes PUT et les en-têtes Content-Type et x-amz-checksum-sha256 pour les origines Web attendues.
- Le serveur vérifie l'objet après transfert ; le client ne peut pas le marquer verified.

## Hors périmètre

Aucune extraction de texte, parsing PDF/DOCX, OCR, antivirus, sandbox, indexation, recherche ou génération de mémoire n'est réalisée dans MEM-023. Ces capacités appartiennent aux lots d'ingestion et d'intelligence suivants. Le checksum SHA-256 vérifie l'intégrité, pas la sûreté du contenu.
