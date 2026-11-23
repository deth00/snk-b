export const ROLE_NAMES = ['admin', 'manager', 'user'];

export const PERMISSION_ACTIONS = [
  { key: 'menu', label: 'ເມນູ' },
  { key: 'view', label: 'ເບິ່ງ' },
  { key: 'create', label: 'ເພີ່ມ' },
  { key: 'edit', label: 'ແກ້ໄຂ' },
  { key: 'delete', label: 'ລົບ' },
];

export const PERMISSIONS = [
  { key: 'tables', label: 'ໂຕະ', group: 'backoffice' },
  { key: 'products', label: 'ສິນຄ້າ', group: 'backoffice' },
  { key: 'stock', label: 'ສະຕ໊ອກ', group: 'backoffice' },
  { key: 'categories', label: 'ປະເພດສິນຄ້າ', group: 'backoffice' },
  { key: 'units', label: 'ໜ່ວຍ', group: 'backoffice' },
  { key: 'stores', label: 'ຮ້ານ / ສາຂາ', group: 'backoffice' },
  { key: 'members', label: 'ສະມາຊິກ', group: 'backoffice' },
  { key: 'orders', label: 'ບິນ / Orders', group: 'backoffice' },
  { key: 'shifts', label: 'ກະ', group: 'backoffice' },
  { key: 'income', label: 'ລາຍຮັບ', group: 'backoffice' },
  { key: 'expense', label: 'ລາຍຈ່າຍ', group: 'backoffice' },
  { key: 'cashDrawer', label: 'ເງິນສົດໃນຄັງ', group: 'backoffice' },
  { key: 'reports', label: 'ລາຍງານ', group: 'backoffice' },
  { key: 'users', label: 'ຜູ້ໃຊ້', group: 'system' },
  { key: 'roles', label: 'ກຳນົດສິດບົດບາດ', group: 'system' },
  { key: 'paymentSettings', label: 'ຕັ້ງຄ່າການຈ່າຍເງິນ', group: 'settings' },
  { key: 'printSettings', label: 'ຕັ້ງຄ່າພິມໃບບິນ', group: 'settings' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((item) => item.key);
export const PERMISSION_ACTION_KEYS = PERMISSION_ACTIONS.map((item) => item.key);

export const PERMISSION_ACTION_OPTIONS = {
  tables: ['view', 'create', 'edit'],
  products: ['view', 'create', 'edit'],
  stock: ['view', 'edit'],
  categories: ['view', 'create', 'edit'],
  units: ['view', 'create', 'edit', 'delete'],
  stores: ['view', 'create', 'edit'],
  members: ['view', 'create', 'edit'],
  orders: ['view', 'create', 'edit', 'delete'],
  shifts: ['view', 'create', 'edit'],
  income: ['view', 'create', 'edit', 'delete'],
  expense: ['view', 'create', 'edit', 'delete'],
  cashDrawer: ['view', 'create'],
  reports: ['view'],
  users: ['view', 'create', 'edit', 'delete'],
  roles: ['view', 'edit'],
  paymentSettings: ['view', 'create', 'edit', 'delete'],
  printSettings: ['view', 'edit'],
};

function allActions(modules) {
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => [
      key,
      PERMISSION_ACTION_KEYS.reduce((actions, action) => {
        actions[action] = modules.includes(key) && (PERMISSION_ACTION_OPTIONS[key] || ['view']).includes(action);
        return actions;
      }, {}),
    ])
  );
}

export const DEFAULT_ROLE_PERMISSION_MODULES = {
  admin: PERMISSION_KEYS,
  manager: [
    'tables',
    'products',
    'stock',
    'categories',
    'units',
    'members',
    'orders',
    'shifts',
    'income',
    'expense',
    'cashDrawer',
    'reports',
    'paymentSettings',
    'printSettings',
  ],
  user: ['shifts'],
};

export const DEFAULT_ROLE_PERMISSIONS = Object.fromEntries(
  Object.entries(DEFAULT_ROLE_PERMISSION_MODULES).map(([role, modules]) => [role, allActions(modules)])
);

export function isKnownPermission(key) {
  return PERMISSION_KEYS.includes(key);
}

export function isKnownPermissionAction(action) {
  return PERMISSION_ACTION_KEYS.includes(action);
}

export function permissionStorageKey(permissionKey, action = 'view') {
  return `${permissionKey}.${action}`;
}

export function splitPermissionStorageKey(key) {
  const [permissionKey, action] = String(key).split('.');
  if (!isKnownPermission(permissionKey) || !isKnownPermissionAction(action)) return null;
  return { permissionKey, action };
}

export function apiPermissionAction(req) {
  const baseUrl = req.baseUrl || '';
  const path = req.path || '';
  if (path.includes('/approve') || path.includes('/reject')) return 'edit';
  if (baseUrl === '/api/sessions' && (path.includes('/pause') || path.includes('/resume') || path.includes('/move') || path.includes('/end'))) return 'edit';
  if (baseUrl === '/api/orders' && path.includes('/checkout')) return 'edit';
  if (baseUrl === '/api/shifts' && path.includes('/close')) return 'edit';
  if (baseUrl === '/api/stock-adjustments' && req.method === 'POST') return 'edit';
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return 'view';
  if (req.method === 'POST') return 'create';
  if (req.method === 'PATCH' || req.method === 'PUT') return 'edit';
  if (req.method === 'DELETE') return 'delete';
  return 'view';
}

export function apiPermissionKey(req) {
  const baseUrl = req.baseUrl || '';
  const path = req.path || '';

  if (baseUrl === '/api/tables') return 'tables';
  if (baseUrl === '/api/rates') return 'tables';
  if (baseUrl === '/api/products') return 'products';
  if (baseUrl === '/api/upload') return 'products';
  if (baseUrl === '/api/product-categories') return 'categories';
  if (baseUrl === '/api/units') return 'units';
  if (baseUrl === '/api/stores') return 'stores';
  if (baseUrl === '/api/branches') return 'stores';
  if (baseUrl === '/api/members') return 'members';
  if (baseUrl === '/api/debts') return 'members';
  if (baseUrl === '/api/orders') return 'orders';
  if (baseUrl === '/api/sessions') return 'orders';
  if (baseUrl === '/api/shifts') return 'shifts';
  if (baseUrl === '/api/incomes') return 'income';
  if (baseUrl === '/api/expenses') return 'expense';
  if (baseUrl === '/api/cash-drawer') return 'cashDrawer';
  if (baseUrl === '/api/reports') return 'reports';
  if (baseUrl === '/api/stock-adjustments') return 'stock';
  if (baseUrl === '/api/users') return 'users';
  if (baseUrl === '/api/role-permissions') return 'roles';
  if (baseUrl === '/api/payment-banks') return 'paymentSettings';
  if (baseUrl === '/api/settings' && path.includes('payment')) return 'paymentSettings';
  if (baseUrl === '/api/settings') return 'printSettings';

  return null;
}
