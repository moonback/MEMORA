# Entities and knowledge relations API

MEM-017 adds workspace-scoped entity management and a typed knowledge graph.

Base path: `/api/workspaces/:workspaceId/entities`.

- `GET /`: list entities with optional type, text/alias search and bounded pagination.
- `POST /`: create a canonical entity with aliases, description and structured attributes.
- `GET /:entityId`: fetch an entity, linked memories and adjacent relations.
- `PATCH /:entityId`: update the canonical name, description, aliases or attributes.
- `POST /:entityId/memories`: link a workspace memory to the entity with its observed mention.
- `DELETE /:entityId/memories/:memoryId`: remove a memory-entity link.
- `POST /:entityId/relations`: create a directed, typed relation with temporal validity, confidence and source-chunk evidence.
- `GET /:entityId/relations`: list incoming/outgoing relations and evidence.
- `DELETE /relations/:relationId`: delete a relation and its evidence.

Entity types: person, organization, place, project, product, topic and other.
Relation types: related_to, works_with, member_of, located_in, part_of, owns, replaces, depends_on and custom.

Canonical names are unique case-insensitively per workspace and entity type. Entity, memory, relation and source-chunk references are validated in the active workspace. PostgreSQL RLS and composite foreign keys provide independent tenant-isolation boundaries. Relation confidence is an integer from 0 to 100; evidence retains the source chunk, optional excerpt and confidence.

Automatic entity extraction, alias resolution across entities, graph traversal/ranking and AI inference are deferred to later milestones.
