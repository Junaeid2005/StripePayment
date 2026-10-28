import { useState } from 'react';
import { ArrowRight, Check, LogIn, Plus, ShieldCheck, UserCheck } from 'lucide-react';
import { HERO_BISTRO_IMAGE, resolveItemImageUrl } from '../data/menuImages';
import { formatGBP, type MenuCategory } from '../shared/catalogData';
import type { ActiveView, CartItem, MenuItemDoc } from '../types';
import { SafeImage } from './SafeImage';
import { useAuth } from '../context/AuthContext';

interface StorefrontViewProps {
  menuItems: MenuItemDoc[];
  loadingMenu: boolean;
  cart: CartItem[];
  onAddToCart: (item: MenuItemDoc) => void;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onOpenCart: () => void;
  onChangeView: (view: ActiveView) => void;
}

const FILTER_TABS: Array<'All' | MenuCategory> = [
  'All',
  'Bites',
  'Bakery',
  'Drinks',
  'Sweets',
];

export function StorefrontView({
  menuItems,
  loadingMenu,
  cart,
  onAddToCart,
  onUpdateQuantity,
  onOpenCart,
  onChangeView,
}: StorefrontViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<'All' | MenuCategory>('All');
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const { user, isAdmin, signInWithGoogle, signOutUser, signingIn } = useAuth();

  const availableItems = menuItems.filter((item) => item.available);
  const filteredItems =
    selectedCategory === 'All'
      ? availableItems
      : availableItems.filter((item) => item.category === selectedCategory);

  const getCartQuantity = (itemId: string) =>
    cart.find((entry) => entry.item.id === itemId)?.quantity ?? 0;

  const handleQuickAdd = (item: MenuItemDoc) => {
    onAddToCart(item);
    setJustAddedId(item.id);
    window.setTimeout(() => {
      setJustAddedId((prev) => (prev === item.id ? null : prev));
    }, 900);
  };

  return (
    <div className="space-y-20 pb-20">
      {/* Section 1: Storefront Split Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-8 lg:pt-12">
        {/* Mobile Secondary Switcher */}
        <div className="flex md:hidden items-center gap-2 pb-6 overflow-x-auto">
          <button
            type="button"
            onClick={() => onChangeView('storefront')}
            className="px-3 py-1.5 text-xs font-semibold bg-stone-900 text-white rounded-md whitespace-nowrap shrink-0"
          >
            Menu
          </button>
          <button
            type="button"
            onClick={() => onChangeView('user')}
            className="px-3 py-1.5 text-xs font-medium bg-stone-100 text-stone-700 rounded-md whitespace-nowrap shrink-0"
          >
            User Panel
          </button>
          <button
            type="button"
            onClick={() => onChangeView('admin')}
            className="px-3 py-1.5 text-xs font-medium bg-stone-100 text-stone-700 rounded-md whitespace-nowrap shrink-0"
          >
            Admin Panel
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between py-2 space-y-8">
            <div className="space-y-5">
              <p className="text-xs font-medium text-stone-500 tracking-wide">
                Shoreditch Counter · Everyday £1.00 to £5.00 Menu · Live Stripe Checkout
              </p>
              <h1
                className="font-display font-bold text-stone-950 tracking-tight leading-[1.08]"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.65rem)', textWrap: 'balance' }}
              >
                Small-batch plates and morning bakes, priced honestly from £1 to £5.
              </h1>
              <p className="text-base text-stone-600 leading-relaxed max-w-xl">
                Every dish on our counter—from flaky cultured-butter croissants to charred
                halloumi flatbreads—is prepared fresh to order and settled securely in British
                Pounds through Stripe Checkout.
              </p>
            </div>

            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href="#menu-catalog"
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Browse £1–£5 Menu</span>
                  <ArrowRight className="w-4 h-4" />
                </a>

                {user ? (
                  <button
                    type="button"
                    onClick={() => onChangeView(isAdmin ? 'admin' : 'user')}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-stone-800 bg-white border border-stone-300 hover:bg-stone-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <UserCheck className="w-4 h-4 text-emerald-900" />
                    <span>{isAdmin ? 'Open Admin Panel' : 'My Orders & Account'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void signInWithGoogle()}
                    disabled={signingIn}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-stone-800 bg-white border border-stone-300 hover:bg-stone-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{signingIn ? 'Connecting...' : 'Google Sign In'}</span>
                  </button>
                )}
              </div>

              {/* Quiet Signed-In Account Bar */}
              {user && (
                <div className="pt-4 border-t border-stone-200/80 flex flex-wrap items-center justify-between gap-4 text-xs text-stone-600">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-stone-900 truncate">
                      {user.displayName || user.email}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{user.email}</span>
                    {isAdmin && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-emerald-900">Verified Admin</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <button
                      type="button"
                      onClick={() => onChangeView('user')}
                      className="font-medium text-stone-700 hover:text-stone-950 underline underline-offset-4 cursor-pointer whitespace-nowrap"
                    >
                      Order History
                    </button>
                    <button
                      type="button"
                      onClick={() => void signOutUser()}
                      className="font-medium text-stone-500 hover:text-stone-900 cursor-pointer whitespace-nowrap"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[320px] rounded-2xl overflow-hidden border border-stone-200/80 bg-stone-100">
              <SafeImage
                src={HERO_BISTRO_IMAGE}
                alt="Sunlit Bistro Five artisan counter with freshly baked croissants, espresso cups, and small savory plates"
                className="w-full h-full object-cover aspect-[16/10] lg:aspect-auto"
              />
            </div>
          </div>
        </div>

        {/* Full-Width Key Storefront Facts Strip Below Hero Split */}
        <div className="mt-10 pt-8 border-t border-stone-200/80 grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="font-mono text-lg font-semibold text-stone-950 tabular-nums">
              £1.00 – £5.00
            </p>
            <p className="text-xs text-stone-500 mt-1">
              Strict counter ceiling across every bake, drink, and plate
            </p>
          </div>
          <div>
            <p className="font-mono text-lg font-semibold text-stone-950 tabular-nums">
              GBP · Live Stripe
            </p>
            <p className="text-xs text-stone-500 mt-1">
              Server-verified Stripe Checkout with instant receipt confirmation
            </p>
          </div>
          <div>
            <p className="font-mono text-lg font-semibold text-stone-950 tabular-nums">
              Google Sign-In
            </p>
            <p className="text-xs text-stone-500 mt-1">
              One-click verified customer login and real-time order tracking
            </p>
          </div>
          <div>
            <p className="font-mono text-lg font-semibold text-stone-950 tabular-nums">
              12 Min Prep
            </p>
            <p className="text-xs text-stone-500 mt-1">
              Prepared fresh to order for Dine-In table service or Takeaway
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: Featured £1-£5 Menu Collection */}
      <section id="menu-catalog" className="max-w-7xl mx-auto px-6 space-y-8 scroll-mt-24">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 border-b border-stone-200/80 pb-6">
          <div className="space-y-1.5">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-stone-950 tracking-tight">
              Today’s Counter Menu
            </h2>
            <p className="text-sm text-stone-600">
              Select items to build your bag and pay securely via Stripe Checkout.
            </p>
          </div>

          {/* Interactive Filter Controls (Segmented Control) */}
          <div
            className="flex items-center gap-1 p-1 bg-stone-200/60 rounded-lg overflow-x-auto"
            role="tablist"
            aria-label="Filter menu by category"
          >
            {FILTER_TABS.map((category) => {
              const active = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-stone-950 shadow-xs'
                      : 'text-stone-600 hover:text-stone-950'
                  }`}
                >
                  {category === 'All' ? 'All Items' : category}
                </button>
              );
            })}
          </div>
        </div>

        {loadingMenu ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3].map((skeleton) => (
              <div
                key={skeleton}
                className="bg-white border border-stone-200/80 rounded-xl overflow-hidden animate-pulse"
              >
                <div className="aspect-[4/3] bg-stone-200/70" />
                <div className="p-5 space-y-3">
                  <div className="h-3 w-24 bg-stone-200 rounded" />
                  <div className="h-5 w-3/4 bg-stone-200 rounded" />
                  <div className="h-4 w-full bg-stone-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white border border-stone-200/80 rounded-xl p-12 text-center space-y-3">
            <p className="text-base font-semibold text-stone-900">
              No items found in {selectedCategory}
            </p>
            <p className="text-sm text-stone-500">
              Switch back to All Items to see everything currently on the counter.
            </p>
            <button
              type="button"
              onClick={() => setSelectedCategory('All')}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-950 rounded-lg cursor-pointer"
            >
              Show All Items
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredItems.map((item) => {
              const qty = getCartQuantity(item.id);
              const isJustAdded = justAddedId === item.id;

              return (
                <article
                  key={item.id}
                  className="group bg-white border border-stone-200/80 rounded-xl overflow-hidden flex flex-col transition-transform duration-150 hover:-translate-y-0.5"
                >
                  <div className="aspect-[4/3] w-full bg-stone-100 overflow-hidden">
                    <SafeImage
                      src={resolveItemImageUrl(item.imageUrl)}
                      alt={item.name}
                      className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between space-y-5">
                    <div className="space-y-2">
                      {/* Clean Unboxed Metadata with Typographic Separator */}
                      <div className="flex items-center gap-2 text-xs text-stone-500">
                        <span>{item.category}</span>
                        {item.dietaryNote && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{item.dietaryNote}</span>
                          </>
                        )}
                      </div>

                      <div className="flex items-baseline justify-between gap-4">
                        <h3 className="text-base font-semibold text-stone-950 leading-snug">
                          {item.name}
                        </h3>
                        <span className="font-mono text-[15px] font-semibold text-stone-950 tabular-nums shrink-0">
                          {formatGBP(item.pricePence)}
                        </span>
                      </div>

                      <p className="text-sm text-stone-600 leading-relaxed">
                        {item.description}
                      </p>
                    </div>

                    <div className="pt-2 flex items-center justify-between gap-3">
                      {qty === 0 ? (
                        <button
                          type="button"
                          onClick={() => handleQuickAdd(item)}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {isJustAdded ? (
                            <>
                              <Check className="w-4 h-4" />
                              <span>Added to Bag</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4" />
                              <span>Add to Bag · {formatGBP(item.pricePence)}</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <div className="w-full flex items-center justify-between gap-3">
                          <div className="inline-flex items-center border border-stone-300 rounded-lg bg-stone-50">
                            <button
                              type="button"
                              onClick={() => onUpdateQuantity(item.id, -1)}
                              aria-label={`Decrease quantity of ${item.name}`}
                              className="w-10 h-10 flex items-center justify-center text-stone-700 hover:text-stone-950 font-semibold cursor-pointer"
                            >
                              −
                            </button>
                            <span className="w-8 text-center font-mono text-sm font-semibold text-stone-950 tabular-nums">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => onUpdateQuantity(item.id, 1)}
                              aria-label={`Increase quantity of ${item.name}`}
                              className="w-10 h-10 flex items-center justify-center text-stone-700 hover:text-stone-950 font-semibold cursor-pointer"
                            >
                              +
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={onOpenCart}
                            className="px-4 py-2.5 text-xs font-semibold text-emerald-950 bg-emerald-950/10 hover:bg-emerald-950/15 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          >
                            View Bag
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 3: Kitchen Craft & Payment Security Assurance */}
      <section id="bistro-craft" className="max-w-7xl mx-auto px-6 scroll-mt-24">
        <div className="bg-white border border-stone-200/80 rounded-2xl p-8 lg:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-4">
            <p className="text-xs font-medium text-stone-500">
              01. Honest Pricing & Verified Checkout
            </p>
            <h2
              className="font-display text-2xl sm:text-3xl font-bold text-stone-950 tracking-tight"
              style={{ textWrap: 'balance' }}
            >
              Crafted fresh every morning, backed by end-to-end server payment verification.
            </h2>
            <p className="text-sm sm:text-base text-stone-600 leading-relaxed max-w-2xl">
              We keep our menu focused on five signature counter staples between £1.00 and
              £5.00. When you check out, item prices are verified directly on the server against
              our Firestore catalog and processed through live Stripe Checkout—your card details
              never touch our servers.
            </p>
          </div>

          <div className="lg:col-span-5 space-y-4 lg:pl-8 lg:border-l lg:border-stone-200/80">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-900 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-950">
                  Live Stripe Checkout Settlement
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Supports major debit and credit cards, Apple Pay, Google Pay, and Link in GBP
                  with real-time PaymentIntent receipts.
                </p>
              </div>
            </div>
            <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500">
              <span>74 Redchurch Street, London E2</span>
              <span>Open Daily · 07:30 – 19:00</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
