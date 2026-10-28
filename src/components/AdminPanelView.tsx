import { useEffect, useState, type FormEvent } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  CheckCircle2,
  Edit3,
  Lock,
  LogIn,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  ADMIN_IMAGE_PRESETS,
  resolveItemImageUrl,
} from '../data/menuImages';
import {
  formatGBP,
  PRIMARY_ADMIN_EMAIL,
  type MenuCategory,
} from '../shared/catalogData';
import type {
  AdminRecordDoc,
  MenuItemDoc,
  OrderDoc,
  OrderStatus,
  StripeVerificationResult,
} from '../types';
import { SafeImage } from './SafeImage';
import {
  seedDefaultMenuToFirestore,
  verifyStripeSessionOnServer,
} from '../services/orderService';

interface AdminPanelViewProps {
  menuItems: MenuItemDoc[];
}

type AdminSection = 'orders' | 'menu' | 'admins';
type OrderFilter = 'all' | 'active' | 'pending' | 'completed';

const CATEGORIES: MenuCategory[] = ['Bites', 'Bakery', 'Drinks', 'Sweets'];
const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  'pending',
  'paid',
  'preparing',
  'ready',
  'completed',
  'cancelled',
];

export function AdminPanelView({ menuItems }: AdminPanelViewProps) {
  const {
    user,
    authReady,
    isAdmin,
    isBootstrapAdmin,
    signInWithGoogle,
    signOutUser,
    signingIn,
  } = useAuth();

  const [section, setSection] = useState<AdminSection>('orders');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');

  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [adminsList, setAdminsList] = useState<AdminRecordDoc[]>([]);
  const [stripeChecks, setStripeChecks] = useState<
    Record<string, StripeVerificationResult>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // Menu Editor Form State
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<MenuCategory>('Bites');
  const [pricePounds, setPricePounds] = useState('3.50');
  const [dietaryNote, setDietaryNote] = useState('Vegetarian');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState(ADMIN_IMAGE_PRESETS[0].value);
  const [available, setAvailable] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Staff Admin Form State
  const [staffUid, setStaffUid] = useState('');
  const [staffEmail, setStaffEmail] = useState('');

  useEffect(() => {
    if (!authReady || !user || !isBootstrapAdmin) {
      setOrders([]);
      setAdminsList([]);
      return;
    }

    const unsubOrders = onSnapshot(
      collection(db, 'orders'),
      (snap) => {
        const list: OrderDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<OrderDoc, 'id'>),
        }));
        list.sort((a, b) => {
          const tA = a.createdAt?.toMillis?.() ?? Date.now();
          const tB = b.createdAt?.toMillis?.() ?? Date.now();
          return tB - tA;
        });
        setOrders(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
    );

    const unsubAdmins = onSnapshot(
      collection(db, 'admins'),
      (snap) => {
        const list: AdminRecordDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AdminRecordDoc, 'id'>),
        }));
        setAdminsList(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'admins')
    );

    return () => {
      unsubOrders();
      unsubAdmins();
    };
  }, [authReady, user, isBootstrapAdmin]);

  if (!authReady) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-16 text-center text-sm text-stone-500">
        Checking administrator permissions...
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="max-w-xl mx-auto px-6 py-16">
        <div className="bg-white border border-stone-200/80 rounded-2xl p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-xl bg-stone-100 text-stone-700 flex items-center justify-center mx-auto">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="font-display text-2xl font-bold text-stone-950">
            Administrator Access Required
          </h1>
          <p className="text-sm text-stone-600 leading-relaxed">
            The Bistro Five Admin Panel is secured via Firestore Security Rules and
            restricted to verified restaurant administrators (
            <span className="font-mono text-xs text-stone-800">{PRIMARY_ADMIN_EMAIL}</span>
            ).
          </p>
          {user ? (
            <div className="space-y-3 pt-2">
              <p className="text-xs text-stone-500">
                Currently signed in as <strong>{user.email}</strong>
              </p>
              <button
                type="button"
                onClick={() => void signOutUser()}
                className="px-5 py-2.5 text-xs font-semibold text-stone-800 bg-stone-100 hover:bg-stone-200 rounded-lg cursor-pointer"
              >
                Sign Out & Switch Google Account
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={signingIn}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{signingIn ? 'Signing In...' : 'Sign In as Admin with Google'}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Metrics
  const paidOrders = orders.filter((o) => o.paymentStatus === 'paid');
  const totalRevenuePence = paidOrders.reduce((s, o) => s + o.totalPence, 0);
  const activeKitchenCount = orders.filter((o) =>
    ['paid', 'preparing', 'ready'].includes(o.status)
  ).length;

  const filteredOrders = orders.filter((o) => {
    if (orderFilter === 'active') {
      return ['paid', 'preparing', 'ready'].includes(o.status);
    }
    if (orderFilter === 'pending') {
      return o.status === 'pending' && o.paymentStatus === 'unpaid';
    }
    if (orderFilter === 'completed') {
      return o.status === 'completed' || o.status === 'cancelled';
    }
    return true;
  });

  const handleUpdateOrderStatus = async (orderId: string, nextStatus: OrderStatus) => {
    setBusyId(orderId);
    setBannerMessage(null);
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleLiveStripeCheck = async (order: OrderDoc) => {
    setBusyId(order.id);
    setBannerMessage(null);
    try {
      const check = await verifyStripeSessionOnServer(order.stripeSessionId);
      setStripeChecks((prev) => ({ ...prev, [order.id]: check }));

      // If Stripe confirms paid and Firestore is still unpaid, sync immediately
      if (check.verified && order.paymentStatus === 'unpaid') {
        await updateDoc(doc(db, 'orders', order.id), {
          status: 'paid',
          paymentStatus: 'paid',
          stripePaymentIntentId: check.paymentIntentId,
          updatedAt: serverTimestamp(),
        });
        setBannerMessage(
          `Stripe confirmed payment for ${order.orderNumber} (${formatGBP(
            check.amountTotal
          )}). Order synced to Paid.`
        );
      }
    } catch (error) {
      setBannerMessage(
        error instanceof Error ? error.message : 'Stripe verification check failed.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const resetMenuForm = () => {
    setEditingItemId(null);
    setName('');
    setCategory('Bites');
    setPricePounds('3.50');
    setDietaryNote('Vegetarian');
    setDescription('');
    setImageUrl(ADMIN_IMAGE_PRESETS[0].value);
    setAvailable(true);
  };

  const handleStartEdit = (item: MenuItemDoc) => {
    setEditingItemId(item.id);
    setName(item.name);
    setCategory(item.category);
    setPricePounds((item.pricePence / 100).toFixed(2));
    setDietaryNote(item.dietaryNote);
    setDescription(item.description);
    setImageUrl(item.imageUrl);
    setAvailable(item.available);
    setSection('menu');
  };

  const handleSaveMenuItem = async (e: FormEvent) => {
    e.preventDefault();
    setBannerMessage(null);

    const parsedPence = Math.round(Number(pricePounds) * 100);
    if (!Number.isInteger(parsedPence) || parsedPence < 100 || parsedPence > 500) {
      setBannerMessage('Menu item price must be between £1.00 and £5.00.');
      return;
    }

    const cleanName = name.trim().slice(0, 80);
    const cleanDesc = description.trim().slice(0, 280);
    const cleanDietary = dietaryNote.trim().slice(0, 60);
    const cleanImage = imageUrl.trim().slice(0, 500);

    if (cleanName.length < 2 || cleanDesc.length < 5) {
      setBannerMessage('Please enter a valid item name and description.');
      return;
    }

    setBusyId('menu-form');
    try {
      if (editingItemId) {
        const existingItem = menuItems.find((m) => m.id === editingItemId);
        await updateDoc(doc(db, 'menuItems', editingItemId), {
          name: cleanName,
          description: cleanDesc,
          category,
          pricePence: parsedPence,
          imageUrl: cleanImage,
          dietaryNote: cleanDietary,
          available,
          sortOrder: existingItem?.sortOrder ?? menuItems.length + 1,
          updatedAt: serverTimestamp(),
        });
        setBannerMessage(`Updated "${cleanName}" (${formatGBP(parsedPence)}).`);
      } else {
        const slugId = `${cleanName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40)}-${Math.floor(100 + Math.random() * 900)}`;

        await setDoc(doc(db, 'menuItems', slugId), {
          name: cleanName,
          description: cleanDesc,
          category,
          pricePence: parsedPence,
          imageUrl: cleanImage,
          dietaryNote: cleanDietary,
          available,
          sortOrder: menuItems.length + 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setBannerMessage(`Added "${cleanName}" (${formatGBP(parsedPence)}) to menu.`);
      }
      resetMenuForm();
    } catch (error) {
      handleFirestoreError(
        error,
        editingItemId ? OperationType.UPDATE : OperationType.CREATE,
        'menuItems'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleItemAvailability = async (item: MenuItemDoc) => {
    setBusyId(item.id);
    try {
      await updateDoc(doc(db, 'menuItems', item.id), {
        name: item.name,
        description: item.description,
        category: item.category,
        pricePence: item.pricePence,
        imageUrl: item.imageUrl,
        dietaryNote: item.dietaryNote,
        available: !item.available,
        sortOrder: item.sortOrder,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `menuItems/${item.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteMenuItem = async (itemId: string) => {
    setBusyId(itemId);
    try {
      await deleteDoc(doc(db, 'menuItems', itemId));
      setConfirmDeleteId(null);
      setBannerMessage('Menu item deleted from Firestore.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `menuItems/${itemId}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleRestoreDefaults = async () => {
    setBusyId('seed-defaults');
    setBannerMessage(null);
    try {
      await seedDefaultMenuToFirestore();
      setBannerMessage('Restored all 5 signature £1.00–£5.00 menu items in Firestore.');
    } catch (error) {
      setBannerMessage(error instanceof Error ? error.message : 'Failed to seed menu.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddStaffAdmin = async (e: FormEvent) => {
    e.preventDefault();
    const cleanUid = staffUid.trim();
    const cleanEmail = staffEmail.trim();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanUid) || cleanEmail.length < 3) {
      setBannerMessage('Enter a valid Firebase UID and staff email address.');
      return;
    }
    setBusyId('add-admin');
    try {
      await setDoc(doc(db, 'admins', cleanUid), {
        uid: cleanUid,
        email: cleanEmail.slice(0, 160),
        addedBy: user.uid,
        createdAt: serverTimestamp(),
      });
      setStaffUid('');
      setStaffEmail('');
      setBannerMessage(`Granted staff admin permissions to ${cleanEmail}.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `admins/${cleanUid}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveStaffAdmin = async (adminUid: string) => {
    setBusyId(adminUid);
    try {
      await deleteDoc(doc(db, 'admins', adminUid));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `admins/${adminUid}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
      {/* Admin Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-stone-200/80 pb-6">
        <div className="space-y-1">
          <p className="text-xs font-medium text-emerald-900">
            Restaurant Operations · Verified Administrator ({user.email})
          </p>
          <h1 className="font-display text-3xl font-bold text-stone-950 tracking-tight">
            Bistro Five Admin Console
          </h1>
        </div>

        {/* Sub-Navigation Segmented Control */}
        <div className="flex items-center gap-1 p-1 bg-stone-200/60 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setSection('orders')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              section === 'orders'
                ? 'bg-white text-stone-950 shadow-xs'
                : 'text-stone-600 hover:text-stone-950'
            }`}
          >
            Live Orders & Stripe ({orders.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('menu')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              section === 'menu'
                ? 'bg-white text-stone-950 shadow-xs'
                : 'text-stone-600 hover:text-stone-950'
            }`}
          >
            Menu Catalog £1–£5 ({menuItems.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('admins')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              section === 'admins'
                ? 'bg-white text-stone-950 shadow-xs'
                : 'text-stone-600 hover:text-stone-950'
            }`}
          >
            Admin Access
          </button>
        </div>
      </div>

      {/* KPI Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-stone-200/80 rounded-xl p-5">
          <p className="text-xs text-stone-500">Paid Stripe Revenue</p>
          <p className="font-mono text-2xl font-bold text-stone-950 tabular-nums mt-1">
            {formatGBP(totalRevenuePence)}
          </p>
        </div>
        <div className="bg-white border border-stone-200/80 rounded-xl p-5">
          <p className="text-xs text-stone-500">Settled Paid Orders</p>
          <p className="font-mono text-2xl font-bold text-emerald-900 tabular-nums mt-1">
            {paidOrders.length}
          </p>
        </div>
        <div className="bg-white border border-stone-200/80 rounded-xl p-5">
          <p className="text-xs text-stone-500">Active Kitchen Queue</p>
          <p className="font-mono text-2xl font-bold text-stone-950 tabular-nums mt-1">
            {activeKitchenCount}
          </p>
        </div>
        <div className="bg-white border border-stone-200/80 rounded-xl p-5">
          <p className="text-xs text-stone-500">Active £1–£5 Dishes</p>
          <p className="font-mono text-2xl font-bold text-stone-950 tabular-nums mt-1">
            {menuItems.filter((m) => m.available).length} / {menuItems.length}
          </p>
        </div>
      </div>

      {bannerMessage && (
        <div className="p-4 rounded-xl bg-white border border-stone-300 text-xs font-medium text-stone-900 flex items-center justify-between gap-4">
          <span>{bannerMessage}</span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-stone-500 hover:text-stone-950 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: LIVE ORDERS & STRIPE VERIFICATION */}
      {section === 'orders' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-xl font-bold text-stone-950">
              Customer Orders & Live Stripe Verification
            </h2>

            <div className="flex items-center gap-1 p-1 bg-stone-200/60 rounded-lg">
              {(
                [
                  ['all', 'All'],
                  ['active', 'Active Kitchen'],
                  ['pending', 'Unpaid Pending'],
                  ['completed', 'Archive'],
                ] as Array<[OrderFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOrderFilter(key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    orderFilter === key
                      ? 'bg-white text-stone-950 shadow-xs'
                      : 'text-stone-600 hover:text-stone-950'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="bg-white border border-stone-200/80 rounded-xl p-12 text-center text-sm text-stone-500">
              No orders in this view yet. Place a £1–£5 test order from the Menu to inspect
              live Stripe verification here.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredOrders.map((order) => {
                const liveCheck = stripeChecks[order.id];
                const isPaid = order.paymentStatus === 'paid';

                return (
                  <div
                    key={order.id}
                    className="bg-white border border-stone-200/80 rounded-xl p-5 space-y-4"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                          <span className="font-mono font-bold text-stone-950">
                            {order.orderNumber}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-stone-800">
                            {order.customerName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{order.customerEmail}</span>
                          <span aria-hidden="true">·</span>
                          <span>{order.diningOption}</span>
                          {order.tableOrNote && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{order.tableOrNote}</span>
                            </>
                          )}
                        </div>

                        <p className="text-sm font-semibold text-stone-950">
                          {order.itemsSummary}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 shrink-0">
                        <div className="text-right">
                          <p className="font-mono text-lg font-bold text-stone-950 tabular-nums">
                            {formatGBP(order.totalPence)}
                          </p>
                          <p
                            className={`text-xs font-semibold ${
                              isPaid ? 'text-emerald-900' : 'text-amber-800'
                            }`}
                          >
                            {isPaid ? 'Paid (GBP)' : 'Unpaid'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <label htmlFor={`status-${order.id}`} className="sr-only">
                            Order Status
                          </label>
                          <select
                            id={`status-${order.id}`}
                            value={order.status}
                            disabled={busyId === order.id}
                            onChange={(e) =>
                              void handleUpdateOrderStatus(
                                order.id,
                                e.target.value as OrderStatus
                              )
                            }
                            className="px-3 py-2 text-xs font-semibold bg-[#FAF9F6] border border-stone-300 rounded-lg text-stone-900 cursor-pointer"
                          >
                            {ORDER_STATUS_OPTIONS.map((st) => (
                              <option key={st} value={st}>
                                Status: {st.toUpperCase()}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => void handleLiveStripeCheck(order)}
                            disabled={busyId === order.id}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg cursor-pointer whitespace-nowrap"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                busyId === order.id ? 'animate-spin' : ''
                              }`}
                            />
                            <span>Verify with Stripe API</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Stripe Session Metadata & Live Check Result */}
                    <div className="pt-3 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-stone-500 font-mono">
                      <span className="truncate">
                        Session: {order.stripeSessionId}
                        {order.stripePaymentIntentId
                          ? ` · Intent: ${order.stripePaymentIntentId}`
                          : ''}
                      </span>

                      {liveCheck && (
                        <span
                          className={`inline-flex items-center gap-1.5 font-sans font-semibold ${
                            liveCheck.verified ? 'text-emerald-900' : 'text-amber-800'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            Live Stripe API: {liveCheck.paymentStatus.toUpperCase()} ·{' '}
                            {formatGBP(liveCheck.amountTotal)}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: £1.00 - £5.00 MENU MANAGEMENT */}
      {section === 'menu' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Form Column */}
          <form
            onSubmit={(e) => void handleSaveMenuItem(e)}
            className="lg:col-span-5 bg-white border border-stone-200/80 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-stone-950">
                {editingItemId ? 'Edit £1–£5 Menu Item' : 'Add New £1–£5 Menu Item'}
              </h2>
              {editingItemId && (
                <button
                  type="button"
                  onClick={resetMenuForm}
                  className="text-xs font-medium text-stone-500 hover:text-stone-950 cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Dish or Drink Name
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Honey Roasted Fig Tartine"
                className="w-full px-3.5 py-2 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as MenuCategory)}
                  className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Price (£1.00 – £5.00)
                </label>
                <input
                  type="number"
                  required
                  min="1.00"
                  max="5.00"
                  step="0.05"
                  value={pricePounds}
                  onChange={(e) => setPricePounds(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono bg-[#FAF9F6] border border-stone-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Dietary / Counter Note
              </label>
              <input
                type="text"
                maxLength={60}
                value={dietaryNote}
                onChange={(e) => setDietaryNote(e.target.value)}
                placeholder="e.g. Vegetarian · Freshly Baked"
                className="w-full px-3.5 py-2 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Photograph Preset
              </label>
              <select
                value={
                  ADMIN_IMAGE_PRESETS.some((p) => p.value === imageUrl)
                    ? imageUrl
                    : 'custom'
                }
                onChange={(e) => {
                  if (e.target.value !== 'custom') {
                    setImageUrl(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg"
              >
                {ADMIN_IMAGE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Custom Image URL</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Tasting Description
              </label>
              <textarea
                rows={3}
                required
                minLength={5}
                maxLength={280}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe ingredients and preparation..."
                className="w-full px-3.5 py-2 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={available}
                onChange={(e) => setAvailable(e.target.checked)}
                className="rounded border-stone-300 text-emerald-950"
              />
              <span>Available on public storefront counter</span>
            </label>

            <button
              type="submit"
              disabled={busyId === 'menu-form'}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>
                {editingItemId ? 'Save Changes to Firestore' : 'Publish £1–£5 Item'}
              </span>
            </button>
          </form>

          {/* Catalog List Column */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-lg font-bold text-stone-950">
                Firestore Menu Items ({menuItems.length})
              </h2>
              <button
                type="button"
                onClick={() => void handleRestoreDefaults()}
                disabled={busyId === 'seed-defaults'}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-800 bg-white border border-stone-300 hover:bg-stone-100 rounded-lg cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Sync Default £1–£5 Menu</span>
              </button>
            </div>

            <div className="space-y-3">
              {menuItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-white border border-stone-200/80 rounded-xl p-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 shrink-0">
                      <SafeImage
                        src={resolveItemImageUrl(item.imageUrl)}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-stone-500">
                        <span>{item.category}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            item.available
                              ? 'font-semibold text-emerald-900'
                              : 'text-stone-400'
                          }
                        >
                          {item.available ? 'In Stock' : 'Hidden / Sold Out'}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-stone-950 truncate">
                        {item.name}
                      </h3>
                      <p className="font-mono text-sm font-bold text-stone-900 tabular-nums">
                        {formatGBP(item.pricePence)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleItemAvailability(item)}
                      disabled={busyId === item.id}
                      className="px-3 py-1.5 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      {item.available ? 'Mark Sold Out' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartEdit(item)}
                      aria-label={`Edit ${item.name}`}
                      className="p-2 text-stone-600 hover:text-stone-950 hover:bg-stone-100 rounded-lg cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {confirmDeleteId === item.id ? (
                      <button
                        type="button"
                        onClick={() => void handleDeleteMenuItem(item.id)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-white bg-red-700 rounded-lg cursor-pointer"
                      >
                        Confirm
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(item.id)}
                        aria-label={`Delete ${item.name}`}
                        className="p-2 text-stone-500 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ADMIN ACCESS */}
      {section === 'admins' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-6 bg-white border border-stone-200/80 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-900" />
              <h2 className="font-display text-lg font-bold text-stone-950">
                Authorized Administrators
              </h2>
            </div>

            <div className="p-4 rounded-xl bg-[#FAF9F6] border border-stone-200/80 space-y-1">
              <p className="text-xs font-semibold text-emerald-900">
                Primary Owner Administrator
              </p>
              <p className="font-mono text-xs text-stone-800">{PRIMARY_ADMIN_EMAIL}</p>
            </div>

            {adminsList.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-xs font-semibold text-stone-600">
                  Additional Staff Admins
                </p>
                {adminsList.map((adm) => (
                  <div
                    key={adm.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg border border-stone-200 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-stone-900 truncate">{adm.email}</p>
                      <p className="font-mono text-[11px] text-stone-500 truncate">
                        UID: {adm.uid}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveStaffAdmin(adm.uid)}
                      disabled={busyId === adm.uid}
                      className="text-red-700 hover:underline cursor-pointer shrink-0"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => void handleAddStaffAdmin(e)}
            className="lg:col-span-6 bg-white border border-stone-200/80 rounded-2xl p-6 space-y-4"
          >
            <h2 className="font-display text-lg font-bold text-stone-950">
              Grant Staff Menu Access
            </h2>
            <p className="text-xs text-stone-600 leading-relaxed">
              Add a verified staff member’s Firebase UID to grant menu and order update
              privileges enforced by Firestore Security Rules.
            </p>
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Staff Firebase UID
              </label>
              <input
                type="text"
                required
                value={staffUid}
                onChange={(e) => setStaffUid(e.target.value)}
                placeholder="Firebase Auth UID"
                className="w-full px-3.5 py-2 text-sm font-mono bg-[#FAF9F6] border border-stone-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Staff Verified Email
              </label>
              <input
                type="email"
                required
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="staff@example.com"
                className="w-full px-3.5 py-2 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={busyId === 'add-admin'}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg cursor-pointer"
            >
              Grant Admin Role
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
