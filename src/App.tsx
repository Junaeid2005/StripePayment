/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from './firebase';
import { AuthProvider, useAuth } from './context/AuthContext';
import { getDefaultMenuDocs } from './data/menuImages';
import { formatGBP } from './shared/catalogData';
import type {
  ActiveView,
  CartItem,
  MenuItemDoc,
  StripeVerificationResult,
} from './types';
import { Navbar } from './components/Navbar';
import { StorefrontView } from './components/StorefrontView';
import { CartCheckoutDrawer } from './components/CartCheckoutDrawer';
import { UserPanelView } from './components/UserPanelView';
import { AdminPanelView } from './components/AdminPanelView';
import {
  confirmOrderPaidInFirestore,
  seedDefaultMenuToFirestore,
} from './services/orderService';

interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      let friendlyMessage = this.state.error.message;
      try {
        const parsed = JSON.parse(this.state.error.message) as { error?: string };
        if (parsed.error) {
          friendlyMessage = parsed.error;
        }
      } catch {
        // Plain text error
      }

      return (
        <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-stone-200 rounded-2xl p-8 space-y-4 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-700 mx-auto" />
            <h1 className="font-display text-xl font-bold text-stone-950">
              Something interrupted the request
            </h1>
            <p className="text-xs text-stone-600 leading-relaxed break-words">
              {friendlyMessage}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                window.location.href = '/';
              }}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-950 rounded-lg cursor-pointer"
            >
              Reload Bistro Five
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function BistroAppContent() {
  const { user, authReady, isBootstrapAdmin, authError, clearAuthError } = useAuth();

  const [activeView, setActiveView] = useState<ActiveView>('storefront');
  const [menuItems, setMenuItems] = useState<MenuItemDoc[]>(() => getDefaultMenuDocs());
  const [loadingMenu, setLoadingMenu] = useState(true);

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('bistro_five_cart');
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  const [isCartOpen, setIsCartOpen] = useState(false);

  const [stripePublishableKey, setStripePublishableKey] = useState('');
  const [returnReceipt, setReturnReceipt] = useState<StripeVerificationResult | null>(
    null
  );
  const autoSeededRef = useRef(false);
  const handledSessionRef = useRef<string | null>(null);

  // Persist cart locally
  useEffect(() => {
    try {
      localStorage.setItem('bistro_five_cart', JSON.stringify(cart));
    } catch {
      // Ignore storage errors
    }
  }, [cart]);

  // Load Stripe Publishable Key from server
  useEffect(() => {
    fetch('/api/stripe/config')
      .then((r) => r.json())
      .then((data: { publishableKey?: string }) => {
        if (data.publishableKey) {
          setStripePublishableKey(data.publishableKey);
        }
      })
      .catch((err) => {
        console.error('Failed to load Stripe configuration:', err);
      });
  }, []);

  // Real-time Firestore Menu Listener + Auto-Seed for First Admin Boot
  useEffect(() => {
    if (!authReady) return;

    const menuCol = collection(db, 'menuItems');
    const q = isBootstrapAdmin
      ? query(menuCol)
      : query(menuCol, where('available', '==', true));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setMenuItems(getDefaultMenuDocs());
          setLoadingMenu(false);

          if (isBootstrapAdmin && !autoSeededRef.current) {
            autoSeededRef.current = true;
            void seedDefaultMenuToFirestore();
          }
          return;
        }

        const docs: MenuItemDoc[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<MenuItemDoc, 'id'>),
        }));
        docs.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
        setMenuItems(docs);
        setLoadingMenu(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'menuItems');
      }
    );

    return () => unsubscribe();
  }, [authReady, isBootstrapAdmin]);

  // Handle Return from Hosted / Redirected Stripe Checkout (?session_id=cs_...)
  useEffect(() => {
    if (!authReady || !user) return;

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (!sessionId || handledSessionRef.current === sessionId) return;

    handledSessionRef.current = sessionId;

    confirmOrderPaidInFirestore({ sessionId })
      .then(({ verification }) => {
        if (verification.verified) {
          setReturnReceipt(verification);
          setCart([]);
          setActiveView('user');
        }
      })
      .catch((err) => {
        console.error('Redirect session verification error:', err);
      })
      .finally(() => {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      });
  }, [authReady, user]);

  const handleAddToCart = (item: MenuItemDoc) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.item.id === item.id
            ? { item, quantity: Math.min(20, c.quantity + 1) }
            : c
        );
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.item.id === itemId
            ? { ...c, quantity: Math.min(20, c.quantity + delta) }
            : c
        )
        .filter((c) => c.quantity > 0)
    );
  };

  const handleClearCart = () => setCart([]);

  const cartCount = cart.reduce((sum, entry) => sum + entry.quantity, 0);
  const cartTotalPence = cart.reduce(
    (sum, entry) => sum + entry.item.pricePence * entry.quantity,
    0
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-stone-900">
      <Navbar
        activeView={activeView}
        onChangeView={setActiveView}
        cartCount={cartCount}
        cartTotalPence={cartTotalPence}
        onOpenCart={() => setIsCartOpen(true)}
      />

      {/* Global Auth Error Notice */}
      {authError && (
        <div className="max-w-7xl mx-auto w-full px-6 pt-4">
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between gap-4 text-xs text-red-900">
            <span>{authError}</span>
            <button
              type="button"
              onClick={clearAuthError}
              aria-label="Dismiss sign-in notice"
              className="text-red-700 hover:text-red-950 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Redirect Return Verified Payment Banner */}
      {returnReceipt && (
        <div className="max-w-7xl mx-auto w-full px-6 pt-6">
          <div className="p-4 rounded-xl bg-white border border-emerald-800/30 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-800 shrink-0" />
              <div className="text-xs">
                <p className="font-semibold text-stone-950">
                  Stripe Payment Confirmed ({returnReceipt.orderNumber || 'Order Paid'}) ·{' '}
                  <span className="font-mono">{formatGBP(returnReceipt.amountTotal)}</span>
                </p>
                <p className="text-stone-600">
                  PaymentIntent {returnReceipt.paymentIntentId} verified and recorded in
                  Firebase.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReturnReceipt(null)}
              className="text-xs font-medium text-stone-500 hover:text-stone-950 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        {activeView === 'storefront' && (
          <StorefrontView
            menuItems={menuItems}
            loadingMenu={loadingMenu}
            cart={cart}
            onAddToCart={handleAddToCart}
            onUpdateQuantity={handleUpdateQuantity}
            onOpenCart={() => setIsCartOpen(true)}
            onChangeView={setActiveView}
          />
        )}

        {activeView === 'user' && <UserPanelView onChangeView={setActiveView} />}

        {activeView === 'admin' && <AdminPanelView menuItems={menuItems} />}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-stone-200/80 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-stone-500">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-sm text-stone-900">
              Bistro Five
            </span>
            <span aria-hidden="true">·</span>
            <span>74 Redchurch Street, Shoreditch, London</span>
          </div>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveView('storefront')}
              className="hover:text-stone-900 cursor-pointer"
            >
              £1–£5 Counter Menu
            </button>
            <button
              type="button"
              onClick={() => setActiveView('user')}
              className="hover:text-stone-900 cursor-pointer"
            >
              User Panel
            </button>
            <button
              type="button"
              onClick={() => setActiveView('admin')}
              className="hover:text-stone-900 cursor-pointer"
            >
              Admin Panel
            </button>
          </div>
        </div>
      </footer>

      <CartCheckoutDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        onUpdateQuantity={handleUpdateQuantity}
        onClearCart={handleClearCart}
        onChangeView={setActiveView}
        stripePublishableKey={stripePublishableKey}
      />
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <BistroAppContent />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
