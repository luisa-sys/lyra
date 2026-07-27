/**
 * KAN-424 (F2): `access-model` — the neutral home for access-state policy.
 *
 * Seed of the future `access` module (KAN-415). Import from `@/lib/access-model`
 * rather than reaching into the file directly.
 */

export {
  computeAccessTransition,
  type AccessAction,
  type AccessTier,
  type AccessTransition,
  type UserStatus,
} from './access-transitions';
