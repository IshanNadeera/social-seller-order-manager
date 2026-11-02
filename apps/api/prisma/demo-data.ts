// Fake demo data for local development and staging (docs/DEVELOPMENT.md §13.2).
// NO REAL CUSTOMER DATA. Every person is fictional, with the surname "Demo"; emails use the reserved
// example.test domain; phone numbers are sequential 077 000 00xx placeholders; streets are "Demo Lane".
// Fixed IDs make the seed idempotent: running it again updates these rows instead of adding more.
// test/demo-data.spec.ts checks all of this.
import type { SriLankaDistrict } from '@ssom/shared';

export const DEMO_OWNER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo.owner@example.test',
  fullName: 'Demo Owner',
} as const;

export const DEMO_BUSINESS = {
  id: '00000000-0000-4000-8000-000000000101',
  name: 'Demo Boutique',
  contactPhone: '077 000 0100',
  orderPrefix: 'DEMO',
  currency: 'LKR',
  timezone: 'Asia/Colombo',
  defaultDeliveryFee: '350.00',
} as const;

export interface DemoAddress {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  /** One of the 25 districts (§7.11): a misspelling is a type error. */
  district: SriLankaDistrict | null;
  postalCode: string | null;
  isDefault: boolean;
}

export interface DemoCustomer {
  id: string;
  name: string;
  phoneDisplay: string | null;
  phoneNormalized: string | null;
  email: string | null;
  notes: string | null;
  addresses: DemoAddress[];
}

const address = (
  n: number,
  recipientName: string,
  phone: string,
  city: string,
  district: SriLankaDistrict,
  extra: Partial<DemoAddress> = {},
): DemoAddress => ({
  id: `00000000-0000-4000-8000-${String(300 + n).padStart(12, '0')}`,
  label: 'Home',
  recipientName,
  phone,
  addressLine1: `${n} Demo Lane`,
  addressLine2: null,
  city,
  district,
  postalCode: null,
  isDefault: true,
  ...extra,
});

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    id: '00000000-0000-4000-8000-000000000201',
    name: 'Amaya Demo',
    phoneDisplay: '077 000 0001',
    phoneNormalized: '+94770000001',
    email: 'amaya.demo@example.test',
    notes: 'Prefers WhatsApp messages.',
    addresses: [address(1, 'Amaya Demo', '077 000 0001', 'Colombo', 'Colombo')],
  },
  {
    id: '00000000-0000-4000-8000-000000000202',
    name: 'Kasun Demo',
    phoneDisplay: '071 000 0002',
    phoneNormalized: '+94710000002',
    email: null,
    notes: null,
    addresses: [
      address(2, 'Kasun Demo', '071 000 0002', 'Kandy', 'Kandy'),
      address(3, 'Kasun Demo (office)', '071 000 0002', 'Colombo', 'Colombo', {
        label: 'Office',
        addressLine2: 'Demo Tower, 3rd floor',
        isDefault: false,
      }),
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000203',
    name: 'Nadeesha Demo',
    phoneDisplay: '+94 76 000 0003',
    phoneNormalized: '+94760000003',
    email: 'nadeesha.demo@example.test',
    notes: null,
    addresses: [
      address(4, 'Nadeesha Demo', '+94 76 000 0003', 'Galle', 'Galle', { postalCode: '80000' }),
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000204',
    name: 'Ravi Demo',
    phoneDisplay: '075-000-0004',
    phoneNormalized: '+94750000004',
    email: null,
    notes: 'Usually collects in person.',
    addresses: [],
  },
  {
    // No phone on record, to exercise optional-phone screens.
    id: '00000000-0000-4000-8000-000000000205',
    name: 'Sanduni Demo',
    phoneDisplay: null,
    phoneNormalized: null,
    email: 'sanduni.demo@example.test',
    notes: null,
    addresses: [address(5, 'Sanduni Demo', '077 000 0005', 'Jaffna', 'Jaffna')],
  },
];

export interface DemoProduct {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  sellingPrice: string;
  archived: boolean;
}

const product = (
  n: number,
  name: string,
  sellingPrice: string,
  extra: Partial<DemoProduct> = {},
): DemoProduct => ({
  id: `00000000-0000-4000-8000-${String(400 + n).padStart(12, '0')}`,
  name,
  sku: `DEMO-${String(n).padStart(3, '0')}`,
  description: null,
  sellingPrice,
  archived: false,
  ...extra,
});

export const DEMO_PRODUCTS: DemoProduct[] = [
  product(1, 'Cotton T-shirt (demo)', '1500.00', {
    description: 'Plain cotton T-shirt, sizes S to XL.',
  }),
  product(2, 'Batik sarong (demo)', '3250.00'),
  product(3, 'Handmade soap set (demo)', '890.00'),
  product(4, 'Beaded necklace (demo)', '2400.50'),
  product(5, 'Gift wrapping (demo)', '200.00', {
    sku: null,
    description: 'Custom service item, no SKU.',
  }),
  product(6, 'Canvas tote bag (demo)', '1850.00'),
  product(7, 'Old season scarf (demo)', '1200.00', { archived: true }),
];
