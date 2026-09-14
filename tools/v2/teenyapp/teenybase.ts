// teenybase config — your schema, auth, and access rules in one file.
// Save → builds and updates preview immediately.
// Commit → executes @migration.sql against the database.
//
// Imports from 'teenybase':
//   sql, sqlValue             — SQL expressions for defaults/triggers/actions (NOT for runtime queries)
//   tableField(name, type, sqlType, options) — field helper
//   baseFields                — scaffolds id (UUID PK), created, updated
//   createdTrigger            — prevents overwriting created timestamp
//   updatedTrigger            — auto-updates updated timestamp on write
//
// Field types: text, number, integer, bool, email, url, date, json, file, relation, select, editor
// Field options: { notNull, unique, default: sql`...`, check, foreignKey: {table, column, onDelete}, noSelect, noInsert, noUpdate }
//
// Rule expressions: auth.uid, auth.role, auth.email, auth.verified, column names, new.col (create/update)
// Operators: == != > < >= <= ~ (LIKE) !~ (NOT LIKE) & (AND) | (OR)
// 'true' = allow all, null/omitted = deny all (secure by default)

import { sql, tableField, baseFields, createdTrigger, updatedTrigger } from 'teenybase'

const users = {
  name: 'users',
  autoSetUid: true,
  fields: [
    ...baseFields,
    tableField('username', 'text', 'text', { notNull: true, unique: true, usage: 'auth_username' }),
    tableField('email', 'text', 'text', { notNull: true, unique: true, usage: 'auth_email', noUpdate: true }),
    tableField('email_verified', 'bool', 'boolean', { notNull: true, default: sql`0`, usage: 'auth_email_verified', noInsert: true, noUpdate: true }),
    tableField('password', 'text', 'text', { notNull: true, usage: 'auth_password', noSelect: true }),
    tableField('password_salt', 'text', 'text', { notNull: true, usage: 'auth_password_salt', noSelect: true, noInsert: true, noUpdate: true }),
    tableField('name', 'text', 'text', { notNull: true, usage: 'auth_name' }),
    tableField('role', 'text', 'text', { default: sql`'user'`, usage: 'auth_audience' }),
    // Or use the authFields preset for all standard auth fields: ...authFields,
  ],
  extensions: [
    {
      name: 'auth',
      passwordType: 'sha256',
      jwtSecret: '$JWT_SECRET_USERS',
      jwtTokenDuration: 3 * 60 * 60,
      maxTokenRefresh: 4,
    },
  ],
  triggers: [createdTrigger, updatedTrigger],
}

// Example table with access rules and foreign key.
// Public can read published posts; only the owner can create/edit/delete.
const posts = {
  name: 'posts',
  autoSetUid: true,
  fields: [
    ...baseFields,
    tableField('owner_id', 'text', 'text', { notNull: true, foreignKey: { table: 'users', column: 'id' } }),
    tableField('title', 'text', 'text', { notNull: true }),
    tableField('body', 'text', 'text', {}),
    tableField('published', 'bool', 'boolean', { default: sql`0` }),
  ],
  indexes: [{ fields: ['owner_id'] }],
  extensions: [
    {
      name: 'rules',
      listRule: 'published == true | (auth.uid != null & owner_id == auth.uid)',
      viewRule: 'published == true | (auth.uid != null & owner_id == auth.uid)',
      createRule: 'auth.uid != null & owner_id == auth.uid',
      updateRule: 'auth.uid != null & owner_id == auth.uid',
      deleteRule: 'auth.uid != null & owner_id == auth.uid',
    },
  ],
  triggers: [createdTrigger, updatedTrigger],
}

// Public file reads; only the authenticated custom publish route may write.
const galleryFiles = {
  name: 'gallery_files',
  autoSetUid: true,
  r2Base: 'gallery',
  fields: [
    ...baseFields,
    tableField('path', 'text', 'text', { notNull: true, unique: true }),
    tableField('mime', 'text', 'text', { notNull: true }),
    tableField('sha256', 'text', 'text', { notNull: true }),
    tableField('blob', 'file', 'text', { notNull: true }),
  ],
  extensions: [{ name: 'rules', listRule: 'true', viewRule: 'true',
    createRule: null, updateRule: null, deleteRule: null }],
  triggers: [createdTrigger, updatedTrigger],
}

export default {
  appName: 'Terminator V2 scene journal',
  appUrl: 'https://terminator-v2-scene-journal.app.teenyapp.com',
  jwtSecret: '$JWT_SECRET_MAIN',
  tables: [users, posts, galleryFiles],
  // Optional: authCookie, email, authProviders, actions — see config-reference.md
}
