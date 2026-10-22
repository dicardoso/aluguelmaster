// Tenants exist as records (contracts and payments reference them) but can't sign in yet.
// Flip ALLOW_TENANT_LOGIN=true to open the platform to them — nothing else needs to change:
// the role, invites, tenant-scoped queries and tenant views are all still in place.
export function tenantLoginEnabled() {
  return process.env.ALLOW_TENANT_LOGIN === 'true';
}
