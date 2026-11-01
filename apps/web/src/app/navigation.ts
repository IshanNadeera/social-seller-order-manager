// The app's navigation, defined once (docs/DEVELOPMENT.md §6.1). The desktop side navigation, the
// mobile bottom bar and the mobile "More" page are all built from this list.
import type { ComponentType, SVGProps } from 'react';
import {
  CustomersIcon,
  HomeIcon,
  MoreIcon,
  OrdersIcon,
  PlusIcon,
  ProductsIcon,
  ReportsIcon,
  SettingsIcon,
} from '../components/icons';
import { strings } from '../lib/strings';

export const PATHS = {
  dashboard: '/',
  orders: '/orders',
  newOrder: '/orders/new',
  customers: '/customers',
  products: '/products',
  reports: '/reports',
  settings: '/settings',
  more: '/more',
} as const;

export interface NavItem {
  key: keyof typeof PATHS;
  path: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Whether this item is the current section for `pathname`. */
  isActive: (pathname: string) => boolean;
}

const exactly = (path: string) => (pathname: string) => pathname === path;
/** A section and everything below it, e.g. /customers and /customers/123. */
const section =
  (path: string, except: string[] = []) =>
  (pathname: string) =>
    (pathname === path || pathname.startsWith(`${path}/`)) && !except.includes(pathname);

const nav = strings.nav;

export const NAV_ITEMS = {
  dashboard: {
    key: 'dashboard',
    path: PATHS.dashboard,
    label: nav.dashboard,
    Icon: HomeIcon,
    isActive: exactly(PATHS.dashboard),
  },
  // "+ New order" has its own button, so the Orders item is not also marked current there.
  orders: {
    key: 'orders',
    path: PATHS.orders,
    label: nav.orders,
    Icon: OrdersIcon,
    isActive: section(PATHS.orders, [PATHS.newOrder]),
  },
  newOrder: {
    key: 'newOrder',
    path: PATHS.newOrder,
    label: nav.newOrder,
    Icon: PlusIcon,
    isActive: exactly(PATHS.newOrder),
  },
  customers: {
    key: 'customers',
    path: PATHS.customers,
    label: nav.customers,
    Icon: CustomersIcon,
    isActive: section(PATHS.customers),
  },
  products: {
    key: 'products',
    path: PATHS.products,
    label: nav.products,
    Icon: ProductsIcon,
    isActive: section(PATHS.products),
  },
  reports: {
    key: 'reports',
    path: PATHS.reports,
    label: nav.reports,
    Icon: ReportsIcon,
    isActive: section(PATHS.reports),
  },
  settings: {
    key: 'settings',
    path: PATHS.settings,
    label: nav.settings,
    Icon: SettingsIcon,
    isActive: section(PATHS.settings),
  },
  // On mobile, "More" stays current while the seller is in one of the sections it lists.
  more: {
    key: 'more',
    path: PATHS.more,
    label: nav.more,
    Icon: MoreIcon,
    isActive: (pathname: string) =>
      pathname === PATHS.more ||
      [PATHS.products, PATHS.reports, PATHS.settings].some((path) => section(path)(pathname)),
  },
} satisfies Record<keyof typeof PATHS, NavItem>;

/** Desktop side navigation, in order (§6.1). "+ New order" is a separate button above it. */
export const DESKTOP_NAV: NavItem[] = [
  NAV_ITEMS.dashboard,
  NAV_ITEMS.orders,
  NAV_ITEMS.customers,
  NAV_ITEMS.products,
  NAV_ITEMS.reports,
  NAV_ITEMS.settings,
];

/** Mobile bottom bar, in order (§6.1); the middle item is the prominent "+ New order". */
export const MOBILE_NAV: NavItem[] = [
  NAV_ITEMS.dashboard,
  NAV_ITEMS.orders,
  NAV_ITEMS.newOrder,
  NAV_ITEMS.customers,
  NAV_ITEMS.more,
];

/** Listed on the mobile "More" page. */
export const MORE_NAV: NavItem[] = [NAV_ITEMS.products, NAV_ITEMS.reports, NAV_ITEMS.settings];
