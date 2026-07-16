# Authorization

Roles aggregate fine-grained permissions; access requests resolve current permissions from live assignments. Permissions gate capabilities, while application services enforce resource scope. For example, `ajo.lock` permits the command class but only the active administrator membership of the target group may lock it.

Organisation/group/wallet/user ownership is always resolved from authenticated identity and persisted relationships. Request-provided ownership is never trusted. Initial roles and permission mappings are deterministic seed data.
