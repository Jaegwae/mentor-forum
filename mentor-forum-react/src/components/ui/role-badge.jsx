// Role badge primitives.
// - `RoleBadge` converts a role key plus optional role-definition override into
//   the canonical label/palette used across the product.
// - `AuthorWithRole` composes the author name and badge in one reusable span so
//   pages can stay focused on layout instead of repeating role-display glue.
import React from 'react';
import { getRoleBadgePalette } from '../../legacy/rbac.js';

function normalizeText(value) {
  return String(value || '').trim();
}

export function RoleBadge({ role, roleDefMap, roleDefinition = null }) {
  const roleKey = normalizeText(role) || 'Newbie';
  const resolvedRoleDef = roleDefinition || roleDefMap?.get?.(roleKey) || null;
  const palette = getRoleBadgePalette(roleKey, resolvedRoleDef);
  const label = resolvedRoleDef?.labelKo || roleKey;

  return (
    <span
      className="role-badge"
      style={{
        background: palette.bgColor,
        color: palette.textColor,
        borderColor: palette.borderColor
      }}
    >
      {label}
    </span>
  );
}

export function AuthorWithRole({ name, role, roleDefMap, roleDefinition = null }) {
  return (
    <span className="author-role-wrap">
      <span className="author-name">{name || '-'}</span>
      <RoleBadge role={role} roleDefMap={roleDefMap} roleDefinition={roleDefinition} />
    </span>
  );
}
