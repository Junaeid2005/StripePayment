import { ShoppingBag } from 'lucide-react';
import { formatGBP } from '../shared/catalogData';
import type { ActiveView } from '../types';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  cartCount: number;
  cartTotalPence: number;
  onOpenCart: () => void;
}

export function Navbar({
  activeView,
  onChangeView,
  cartCount,
  cartTotalPence,
  onOpenCart,
}: NavbarProps) {
  const { user, signInWithGoogle, signingIn } = useAuth();

  const handleNavMenu = () => {
    onChangeView('storefront');
    window.setTimeout(() => {
      document.getElementById('menu-catalog')?.scrollIntoView({ behavior: 'smooth' });
    }, 40);
  };

  const handleNavCraft = () => {
    onChangeView('storefront');
    window.setTimeout(() => {
      document.getElementById('bistro-craft')?.scrollIntoView({ behavior: 'smooth' });
    }, 40);
  };

  return (
    <header className="sticky top-0 z-30 bg-[#FAF9F6]/95 backdrop-blur-md border-b border-stone-200/80">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-4">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onChangeView('storefront')}
          className="font-display text-xl font-bold tracking-tight text-stone-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-900 cursor-pointer"
        >
          Bistro Five
        </button>

        {/* Zone 2: 4 Single-line Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-stone-600">
          <button
            type="button"
            onClick={handleNavMenu}
            className={`hover:text-stone-950 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 cursor-pointer ${
              activeView === 'storefront'
                ? 'border-stone-900 text-stone-950'
                : 'border-transparent'
            }`}
          >
            Menu
          </button>
          <button
            type="button"
            onClick={handleNavCraft}
            className="hover:text-stone-950 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent cursor-pointer"
          >
            Kitchen Craft
          </button>
          <button
            type="button"
            onClick={() => onChangeView('user')}
            className={`hover:text-stone-950 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 cursor-pointer ${
              activeView === 'user'
                ? 'border-stone-900 text-stone-950'
                : 'border-transparent'
            }`}
          >
            User Panel
          </button>
          <button
            type="button"
            onClick={() => onChangeView('admin')}
            className={`hover:text-stone-950 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 cursor-pointer ${
              activeView === 'admin'
                ? 'border-stone-900 text-stone-950'
                : 'border-transparent'
            }`}
          >
            Admin Panel
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          {cartCount > 0 ? (
            <button
              type="button"
              onClick={onOpenCart}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900"
            >
              <ShoppingBag className="w-4 h-4 shrink-0" />
              <span className="font-mono tabular-nums">
                Checkout · {formatGBP(cartTotalPence)} ({cartCount})
              </span>
            </button>
          ) : !user ? (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={signingIn}
              className="px-4 py-2.5 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900"
            >
              {signingIn ? 'Signing In...' : 'Sign In with Google'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenCart}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-stone-900 bg-white border border-stone-300 hover:bg-stone-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4 shrink-0" />
              <span>View Bag (0)</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
