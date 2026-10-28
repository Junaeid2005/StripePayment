import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  LogIn,
  LogOut,
  RefreshCw,
  ShoppingBag,
  XCircle,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { formatGBP } from '../shared/catalogData';
import type { ActiveView, OrderDoc, OrderItemDoc, OrderStatus } from '../types';
import {
  cancelCustomerPendingOrder,
  confirmOrderPaidInFirestore,
  fetchOrderLineItems,
} from '../services/orderService';

interface UserPanelViewProps {
  onChangeView: (view: ActiveView) => void;
}

const KITCHEN_STEPS: OrderStatus[] = ['paid', 'preparing', 'ready', 'completed'];

function formatOrderTimestamp(order: OrderDoc): string {
  if (!order.createdAt || typeof order.createdAt.toDate !== 'function') {
    return 'Just now';
  }
  return order.createdAt.toDate().toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'pending':
      return 'Awaiting Payment';
    case 'paid':
      return 'Order Received (Paid)';
    case 'preparing':
      return 'Preparing in Kitchen';
    case 'ready':
      return 'Ready at Counter';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function UserPanelView({ onChangeView }: UserPanelViewProps) {
  const { user, authReady, isBootstrapAdmin, signInWithGoogle, signOutUser, signingIn } =
    useAuth();
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [lineItemsByOrder, setLineItemsByOrder] = useState<Record<string, OrderItemDoc[]>>(
    {}
  );
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!authReady || !user) {
      setOrders([]);
      setLoadingOrders(false);
      return;
    }

    setLoadingOrders(true);
    const q = query(collection(db, 'orders'), where('userId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs: OrderDoc[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<OrderDoc, 'id'>),
        }));
        docs.sort((a, b) => {
          const tA = a.createdAt?.toMillis?.() ?? Date.now();
          const tB = b.createdAt?.toMillis?.() ?? Date.now();
          return tB - tA;
        });
        setOrders(docs);
        setLoadingOrders(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'orders');
      }
    );

    return () => unsubscribe();
  }, [authReady, user]);

  const handleToggleDetails = async (order: OrderDoc) => {
    if (expandedOrderId === order.id) {
      setExpandedOrderId(null);
      return;
    }
    setExpandedOrderId(order.id);
    if (!lineItemsByOrder[order.id] && user) {
      try {
        const items = await fetchOrderLineItems(order.id, user.uid, isBootstrapAdmin);
        setLineItemsByOrder((prev) => ({ ...prev, [order.id]: items }));
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleVerifyOrder = async (order: OrderDoc) => {
    setBusyOrderId(order.id);
    setFeedback(null);
    try {
      const { verification } = await confirmOrderPaidInFirestore({
        sessionId: order.stripeSessionId,
        knownOrderId: order.id,
      });
      if (verification.verified) {
        setFeedback(`Order ${order.orderNumber} verified as PAID on Stripe.`);
      } else {
        setFeedback(
          `Order ${order.orderNumber} is currently "${verification.paymentStatus}" on Stripe.`
        );
      }
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : 'Unable to check Stripe status.'
      );
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleCancelOrder = async (order: OrderDoc) => {
    setBusyOrderId(order.id);
    setFeedback(null);
    try {
      await cancelCustomerPendingOrder(order.id);
      setFeedback(`Order ${order.orderNumber} was cancelled.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to cancel order.');
    } finally {
      setBusyOrderId(null);
    }
  };

  if (!authReady) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-16 text-center text-sm text-stone-500">
        Loading your account...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-6 py-16">
        <div className="bg-white border border-stone-200/80 rounded-2xl p-8 text-center space-y-5">
          <h1 className="font-display text-2xl font-bold text-stone-950">
            Customer Panel & Order Tracking
          </h1>
          <p className="text-sm text-stone-600 leading-relaxed">
            Sign in with your Google account to view your live Bistro Five order receipts,
            Stripe payment confirmations, and kitchen preparation status.
          </p>
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            disabled={signingIn}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg transition-colors cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            <span>{signingIn ? 'Signing In...' : 'Continue with Google'}</span>
          </button>
        </div>
      </div>
    );
  }

  const paidOrdersCount = orders.filter((o) => o.paymentStatus === 'paid').length;
  const totalSpentPence = orders
    .filter((o) => o.paymentStatus === 'paid')
    .reduce((sum, o) => sum + o.totalPence, 0);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      {/* Customer Header */}
      <div className="bg-white border border-stone-200/80 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4 min-w-0">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || 'Customer avatar'}
              referrerPolicy="no-referrer"
              className="w-14 h-14 rounded-full object-cover border border-stone-200 shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-stone-900 text-white flex items-center justify-center font-display text-lg font-bold shrink-0">
              {(user.displayName || user.email || 'G')[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium text-stone-500">Customer Account</p>
            <h1 className="font-display text-2xl font-bold text-stone-950 truncate">
              {user.displayName || 'Guest'}
            </h1>
            <p className="text-xs text-stone-600 truncate mt-0.5">{user.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onChangeView('storefront')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Order from £1–£5 Menu</span>
          </button>
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Customer Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-stone-200/80 rounded-xl p-5">
          <p className="text-xs text-stone-500">Total Orders</p>
          <p className="font-mono text-2xl font-semibold text-stone-950 tabular-nums mt-1">
            {orders.length}
          </p>
        </div>
        <div className="bg-white border border-stone-200/80 rounded-xl p-5">
          <p className="text-xs text-stone-500">Paid via Stripe</p>
          <p className="font-mono text-2xl font-semibold text-emerald-900 tabular-nums mt-1">
            {paidOrdersCount}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-white border border-stone-200/80 rounded-xl p-5">
          <p className="text-xs text-stone-500">Total Settled (GBP)</p>
          <p className="font-mono text-2xl font-semibold text-stone-950 tabular-nums mt-1">
            {formatGBP(totalSpentPence)}
          </p>
        </div>
      </div>

      {feedback && (
        <div className="p-4 rounded-xl bg-white border border-stone-300 text-xs font-medium text-stone-800 flex items-center justify-between gap-4">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-stone-500 hover:text-stone-950 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Orders List */}
      <div className="space-y-4">
        <h2 className="font-display text-xl font-bold text-stone-950">
          Your Order History
        </h2>

        {loadingOrders ? (
          <div className="bg-white border border-stone-200/80 rounded-xl p-10 text-center text-sm text-stone-500">
            Loading your orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white border border-stone-200/80 rounded-xl p-12 text-center space-y-3">
            <p className="text-base font-semibold text-stone-900">No orders placed yet</p>
            <p className="text-sm text-stone-500 max-w-md mx-auto">
              Choose any £1.00–£5.00 dish from our counter menu and complete Stripe Checkout
              to see live order tracking here.
            </p>
            <button
              type="button"
              onClick={() => onChangeView('storefront')}
              className="mt-2 px-5 py-2.5 text-xs font-semibold text-white bg-emerald-950 rounded-lg cursor-pointer"
            >
              Explore Menu
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const isPaid = order.paymentStatus === 'paid';
              const stepIdx = KITCHEN_STEPS.indexOf(order.status);
              const isExpanded = expandedOrderId === order.id;
              const lines = lineItemsByOrder[order.id];

              return (
                <article
                  key={order.id}
                  className="bg-white border border-stone-200/80 rounded-xl p-5 sm:p-6 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                        <span className="font-mono font-semibold text-stone-950">
                          {order.orderNumber}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatOrderTimestamp(order)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{order.diningOption}</span>
                        {order.tableOrNote && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{order.tableOrNote}</span>
                          </>
                        )}
                      </div>
                      <p className="text-sm font-medium text-stone-900">
                        {order.itemsSummary}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="font-mono text-base font-bold text-stone-950 tabular-nums">
                          {formatGBP(order.totalPence)}
                        </p>
                        <div className="flex items-center justify-end gap-1.5 text-xs mt-0.5">
                          {isPaid ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-800" />
                              <span className="font-semibold text-emerald-900">
                                Paid via Stripe
                              </span>
                            </>
                          ) : order.status === 'cancelled' ? (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-stone-400" />
                              <span className="text-stone-500">Cancelled</span>
                            </>
                          ) : (
                            <>
                              <Clock className="w-3.5 h-3.5 text-amber-700" />
                              <span className="font-medium text-amber-800">
                                Payment Pending
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Kitchen Progress Bar for Paid Orders */}
                  {isPaid && order.status !== 'cancelled' && (
                    <div className="pt-3 border-t border-stone-100 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-stone-800">
                          Kitchen Status: {getStatusLabel(order.status)}
                        </span>
                        {order.stripePaymentIntentId && (
                          <span className="font-mono text-[11px] text-stone-500 truncate max-w-[200px]">
                            Ref: {order.stripePaymentIntentId}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {KITCHEN_STEPS.map((st, idx) => {
                          const reached = stepIdx >= idx;
                          return (
                            <div key={st} className="space-y-1">
                              <div
                                className={`h-1.5 rounded-full ${
                                  reached ? 'bg-emerald-900' : 'bg-stone-200'
                                }`}
                              />
                              <p
                                className={`text-[11px] capitalize ${
                                  reached
                                    ? 'font-semibold text-stone-900'
                                    : 'text-stone-400'
                                }`}
                              >
                                {st}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions for Unpaid Pending Orders + Expandable Receipt */}
                  <div className="pt-3 border-t border-stone-100 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => void handleToggleDetails(order)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-950 cursor-pointer"
                    >
                      <span>{isExpanded ? 'Hide Receipt Lines' : 'View Receipt Lines'}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {order.status === 'pending' && order.paymentStatus === 'unpaid' && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void handleCancelOrder(order)}
                          disabled={busyOrderId === order.id}
                          className="text-xs font-medium text-stone-500 hover:text-red-700 cursor-pointer"
                        >
                          Cancel Order
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleVerifyOrder(order)}
                          disabled={busyOrderId === order.id}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg cursor-pointer"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              busyOrderId === order.id ? 'animate-spin' : ''
                            }`}
                          />
                          <span>Verify Stripe Payment</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="bg-[#FAF9F6] border border-stone-200/80 rounded-lg p-4 space-y-2 text-xs">
                      {!lines ? (
                        <p className="text-stone-500">Loading line items...</p>
                      ) : (
                        lines.map((line) => (
                          <div
                            key={line.id}
                            className="flex items-center justify-between gap-4 py-1 border-b border-stone-200/60 last:border-b-0"
                          >
                            <span className="text-stone-800">
                              <strong className="font-mono">{line.quantity}x</strong>{' '}
                              {line.name}
                            </span>
                            <span className="font-mono font-semibold text-stone-950 tabular-nums">
                              {formatGBP(line.lineTotalPence)}
                            </span>
                          </div>
                        ))
                      )}
                      <div className="pt-2 flex items-center justify-between text-[11px] text-stone-500 font-mono">
                        <span>Stripe Session</span>
                        <span className="truncate max-w-[260px]">
                          {order.stripeSessionId}
                        </span>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
