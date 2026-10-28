import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Lock,
  LogIn,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { formatGBP } from '../shared/catalogData';
import { resolveItemImageUrl } from '../data/menuImages';
import type {
  ActiveView,
  CartItem,
  DiningOption,
  StripeVerificationResult,
} from '../types';
import { SafeImage } from './SafeImage';
import { useAuth } from '../context/AuthContext';
import {
  cancelCustomerPendingOrder,
  confirmOrderPaidInFirestore,
  initiateStripeOrder,
} from '../services/orderService';

interface CartCheckoutDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onClearCart: () => void;
  onChangeView: (view: ActiveView) => void;
}

type DrawerStep = 'bag' | 'iframe_redirect_bridge' | 'paid_receipt';

export function CartCheckoutDrawer({
  isOpen,
  onClose,
  cart,
  onUpdateQuantity,
  onClearCart,
  onChangeView,
}: CartCheckoutDrawerProps) {
  const { user, signInWithGoogle, signingIn } = useAuth();

  const [step, setStep] = useState<DrawerStep>('bag');
  const [diningOption, setDiningOption] = useState<DiningOption>('Dine In');
  const [tableOrNote, setTableOrNote] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeOrderNumber, setActiveOrderNumber] = useState<string>('');
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<StripeVerificationResult | null>(null);

  const totalPence = cart.reduce(
    (sum, entry) => sum + entry.item.pricePence * entry.quantity,
    0
  );
  const totalCount = cart.reduce((sum, entry) => sum + entry.quantity, 0);

  useEffect(() => {
    if (isOpen && step === 'bag') {
      setErrorMessage(null);
    }
  }, [isOpen, step]);

  const handleProceedToStripe = async () => {
    setErrorMessage(null);
    setRedirecting(true);
    try {
      let activeUser = user;
      if (!activeUser) {
        activeUser = await signInWithGoogle();
        if (!activeUser) {
          setRedirecting(false);
          return;
        }
      }

      const result = await initiateStripeOrder({
        cart,
        diningOption,
        tableOrNote,
      });

      setActiveOrderId(result.orderId);
      setActiveSessionId(result.sessionId);
      setActiveOrderNumber(result.orderNumber);
      setHostedUrl(result.hostedUrl);

      // Direct full-page redirect on normal browser tabs (Vercel, custom domain, standalone tab)
      const isEmbeddedInIframe = window.self !== window.top;
      if (!isEmbeddedInIframe) {
        window.location.assign(result.hostedUrl);
        return;
      }

      // Inside AI Studio preview iframe (where Stripe sets X-Frame-Options: DENY),
      // present direct 1-click navigation to checkout.stripe.com
      setStep('iframe_redirect_bridge');
      setRedirecting(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to redirect to Stripe Checkout.'
      );
      setRedirecting(false);
    }
  };

  const handleVerifyCompletion = useCallback(async () => {
    if (!activeSessionId) return;
    setRedirecting(true);
    setErrorMessage(null);
    try {
      const { verification } = await confirmOrderPaidInFirestore({
        sessionId: activeSessionId,
        knownOrderId: activeOrderId || undefined,
      });

      if (verification.verified) {
        setReceipt(verification);
        setStep('paid_receipt');
        onClearCart();
      } else {
        setErrorMessage(
          `Stripe payment status is "${verification.paymentStatus}". Complete payment on Stripe first, then click Verify.`
        );
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not verify payment status.'
      );
    } finally {
      setRedirecting(false);
    }
  }, [activeOrderId, activeSessionId, onClearCart]);

  const handleCancelPending = async () => {
    if (activeOrderId && step !== 'paid_receipt') {
      try {
        await cancelCustomerPendingOrder(activeOrderId);
      } catch {
        // Ignore if already updated
      }
    }
    setHostedUrl(null);
    setActiveOrderId(null);
    setActiveSessionId(null);
    setErrorMessage(null);
    setStep('bag');
  };

  const handleCloseDrawer = () => {
    if (step === 'paid_receipt') {
      setStep('bag');
      setReceipt(null);
      setActiveOrderId(null);
      setActiveSessionId(null);
      setHostedUrl(null);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-stone-950/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Order bag and Stripe Checkout"
    >
      <div className="relative w-full max-w-lg bg-[#FAF9F6] h-full flex flex-col shadow-2xl border-l border-stone-200 transition-transform duration-150">
        {/* Drawer Header */}
        <div className="px-6 py-4 bg-white border-b border-stone-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-stone-950">
              {step === 'bag' && `Your Counter Bag (${totalCount})`}
              {step === 'iframe_redirect_bridge' &&
                `Continue to Stripe · ${activeOrderNumber}`}
              {step === 'paid_receipt' && 'Payment Confirmed'}
            </h2>
            <p className="text-xs text-stone-500">
              {step === 'bag' && 'All prices settled in British Pounds (£ GBP)'}
              {step === 'iframe_redirect_bridge' &&
                'Redirecting securely to official Stripe Checkout'}
              {step === 'paid_receipt' && 'Verified directly with Stripe Live API'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleCloseDrawer}
            aria-label="Close bag drawer"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-stone-500 hover:text-stone-950 hover:bg-stone-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-900">
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'bag' && (
            <>
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-16 space-y-3">
                  <p className="text-base font-semibold text-stone-900">
                    Your counter bag is empty
                  </p>
                  <p className="text-sm text-stone-500 max-w-xs">
                    Add any £1.00–£5.00 dish or drink from our menu to proceed to Stripe
                    Checkout.
                  </p>
                  <button
                    type="button"
                    onClick={handleCloseDrawer}
                    className="mt-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-950 rounded-lg cursor-pointer"
                  >
                    Browse Menu
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Itemized List */}
                  <div className="space-y-3">
                    {cart.map(({ item, quantity }) => (
                      <div
                        key={item.id}
                        className="bg-white border border-stone-200/80 rounded-xl p-3.5 flex items-center gap-3.5"
                      >
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 shrink-0">
                          <SafeImage
                            src={resolveItemImageUrl(item.imageUrl)}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-stone-950 truncate">
                            {item.name}
                          </h3>
                          <p className="font-mono text-xs text-stone-500 tabular-nums mt-0.5">
                            {formatGBP(item.pricePence)} each
                          </p>

                          <div className="mt-2 flex items-center justify-between">
                            <div className="inline-flex items-center border border-stone-200 rounded-md bg-stone-50">
                              <button
                                type="button"
                                onClick={() => onUpdateQuantity(item.id, -1)}
                                className="w-7 h-7 flex items-center justify-center text-stone-700 hover:text-stone-950 text-xs font-semibold cursor-pointer"
                              >
                                −
                              </button>
                              <span className="w-7 text-center font-mono text-xs font-semibold tabular-nums">
                                {quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => onUpdateQuantity(item.id, 1)}
                                className="w-7 h-7 flex items-center justify-center text-stone-700 hover:text-stone-950 text-xs font-semibold cursor-pointer"
                              >
                                +
                              </button>
                            </div>

                            <span className="font-mono text-sm font-semibold text-stone-950 tabular-nums">
                              {formatGBP(item.pricePence * quantity)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Dining Preference */}
                  <div className="bg-white border border-stone-200/80 rounded-xl p-4 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-2">
                        Service Preference
                      </label>
                      <div className="grid grid-cols-2 gap-2 p-1 bg-stone-100 rounded-lg">
                        {(['Dine In', 'Takeaway'] as DiningOption[]).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setDiningOption(opt)}
                            className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                              diningOption === opt
                                ? 'bg-white text-stone-950 shadow-xs'
                                : 'text-stone-600 hover:text-stone-950'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="table-or-note"
                        className="block text-xs font-semibold text-stone-700 mb-1.5"
                      >
                        {diningOption === 'Dine In'
                          ? 'Table Number or Kitchen Note (Optional)'
                          : 'Pickup Note (Optional)'}
                      </label>
                      <input
                        id="table-or-note"
                        type="text"
                        maxLength={120}
                        value={tableOrNote}
                        onChange={(e) => setTableOrNote(e.target.value)}
                        placeholder={
                          diningOption === 'Dine In'
                            ? 'e.g. Table 4, extra hot milk'
                            : 'e.g. Collecting in 10 mins'
                        }
                        className="w-full px-3.5 py-2 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg focus:outline-none focus:border-emerald-900"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={onClearCart}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-red-700 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear Bag</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'iframe_redirect_bridge' && hostedUrl && (
            <div className="bg-white border border-stone-200/80 rounded-xl p-6 space-y-5">
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-stone-950">
                  Stripe Payment Page Ready ({activeOrderNumber})
                </h3>
                <p className="text-sm text-stone-600 leading-relaxed">
                  Because you are viewing inside an embedded preview frame, click below to
                  open Stripe’s payment page directly. On your live Vercel domain, this
                  redirects automatically.
                </p>
              </div>

              <a
                href={hostedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg transition-colors"
              >
                <span>Go to Stripe Payment Page</span>
                <ExternalLink className="w-4 h-4" />
              </a>

              <div className="pt-4 border-t border-stone-200 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void handleCancelPending()}
                  className="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-950 cursor-pointer"
                >
                  Back to Bag
                </button>
                <button
                  type="button"
                  onClick={() => void handleVerifyCompletion()}
                  disabled={redirecting}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-emerald-950 bg-emerald-950/10 hover:bg-emerald-950/15 rounded-lg cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${redirecting ? 'animate-spin' : ''}`}
                  />
                  <span>{redirecting ? 'Checking...' : 'I Have Paid · Verify'}</span>
                </button>
              </div>
            </div>
          )}

          {step === 'paid_receipt' && receipt && (
            <div className="bg-white border border-stone-200/80 rounded-xl p-6 space-y-6">
              <div className="flex items-start gap-3.5">
                <CheckCircle2 className="w-6 h-6 text-emerald-800 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="font-display text-xl font-bold text-stone-950">
                    Order {receipt.orderNumber || activeOrderNumber} Confirmed
                  </h3>
                  <p className="text-sm text-stone-600">
                    Your live Stripe payment has been verified and recorded in Firebase.
                  </p>
                </div>
              </div>

              <dl className="divide-y divide-stone-100 border-y border-stone-200 py-2 text-sm">
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-stone-500">Amount Paid</dt>
                  <dd className="font-mono font-semibold text-stone-950 tabular-nums">
                    {formatGBP(receipt.amountTotal)} GBP
                  </dd>
                </div>
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-stone-500">Payment Intent</dt>
                  <dd className="font-mono text-xs text-stone-700 truncate max-w-[220px]">
                    {receipt.paymentIntentId}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={() => {
                  handleCloseDrawer();
                  onChangeView('user');
                }}
                className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg cursor-pointer"
              >
                View Order in User Panel
              </button>
            </div>
          )}
        </div>

        {/* Sticky Bag Footer — Direct Stripe Redirect Button */}
        {step === 'bag' && cart.length > 0 && (
          <div className="p-6 bg-white border-t border-stone-200 space-y-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between text-stone-600">
                <span>Items ({totalCount})</span>
                <span className="font-mono tabular-nums">{formatGBP(totalPence)}</span>
              </div>
              <div className="flex items-center justify-between text-base font-bold text-stone-950 pt-2 border-t border-stone-100">
                <span>Total (GBP)</span>
                <span className="font-mono tabular-nums">{formatGBP(totalPence)}</span>
              </div>
            </div>

            {!user ? (
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                disabled={signingIn}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>
                  {signingIn
                    ? 'Signing In with Google...'
                    : `Sign In with Google to Pay ${formatGBP(totalPence)}`}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleProceedToStripe()}
                disabled={redirecting}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>
                  {redirecting
                    ? 'Redirecting to Stripe Checkout...'
                    : `Pay ${formatGBP(totalPence)} with Stripe`}
                </span>
                {!redirecting && <ArrowRight className="w-4 h-4" />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
