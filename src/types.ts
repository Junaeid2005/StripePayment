import type { Timestamp } from 'firebase/firestore';
import type { MenuCategory } from './shared/catalogData';

export type ActiveView = 'storefront' | 'user' | 'admin';

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled';

export type PaymentStatus = 'unpaid' | 'paid';

export type DiningOption = 'Dine In' | 'Takeaway';

export interface MenuItemDoc {
  id: string;
  name: string;
  description: string;
  category: MenuCategory;
  pricePence: number;
  imageUrl: string;
  dietaryNote: string;
  available: boolean;
  sortOrder: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CartItem {
  item: MenuItemDoc;
  quantity: number;
}

export interface OrderDoc {
  id: string;
  orderNumber: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  diningOption: DiningOption;
  tableOrNote: string;
  itemsSummary: string;
  itemCount: number;
  totalPence: number;
  currency: 'gbp';
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  stripeSessionId: string;
  stripePaymentIntentId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface OrderItemDoc {
  id: string;
  orderId: string;
  userId: string;
  menuItemId: string;
  name: string;
  unitPricePence: number;
  quantity: number;
  lineTotalPence: number;
  createdAt?: Timestamp;
}

export interface AdminRecordDoc {
  id: string;
  uid: string;
  email: string;
  addedBy: string;
  createdAt?: Timestamp;
}

export interface StripeVerificationResult {
  verified: boolean;
  sessionId: string;
  status: string;
  paymentStatus: string;
  amountTotal: number;
  currency: string;
  paymentIntentId: string;
  orderNumber: string;
  customerEmail: string;
}
