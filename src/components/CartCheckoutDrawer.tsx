import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from '@stripe/react-stripe-js';
import {
  AlertCircle,
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
  stripePublishableKey: string;
}

type DrawerStep = 'bag' | 'embedded_checkout' | 'hosted_waiting' | 'paid_receipt';

export function CartCheckoutDrawer({
  isOpen,
  onClose,
  cart,
  onUpdateQuantity,
  onClearCart,
  onChangeView,
  stripePublishableKey,
}: CartCheckoutDrawerProps) {
  const { user, signInWithGoogle, signingIn } = useAuth();

  const [step, setStep] = useState<DrawerStep>('bag');
  const [diningOption, setDiningOption] = useState<DiningOption>('Dine In');
  const [tableOrNote, setTableOrNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeOrderNumber, setActiveOrderNumber] = useState<string>('');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<StripeVerificationResult | null>(null);

  const stripePromise: Promise<StripeJs | null> | null = useMemo(() => {
    if (!stripePublishableKey) return null;
    return loadStripe(stripePublishableKey);
  }, [stripePublishableKey]);

  const totalPence = cart.reduce(
    (sum, entry) => sum + entry.item.pricePence * entry.quantity,
    0
  );
  const totalCount = cart.reduce((sum, entry) => sum + entry.quantity, 0);

  // Reset error when opening drawer
  useEffect(() => {
    if (isOpen && step === 'bag') {
      setErrorMessage(null);
    }
  }, [isOpen, step]);

  const handleStartCheckout = async (mode: 'embedded' | 'hosted') => {
    setErrorMessage(null);
    setBusy(true);
    try {
      let activeUser = user;
      if (!activeUser) {
        activeUser = await signInWithGoogle();
        if (!activeUser) {
          setBusy(false);
          return;
        }
      }

      const result = await initiateStripeOrder({
        cart,
        diningOption,
        tableOrNote,
        checkoutMode: mode,
      });

      setActiveOrderId(result.orderId);
      setActiveSessionId(result.sessionId);
      setActiveOrderNumber(result.orderNumber);

      if (mode === 'hosted' && result.hostedUrl) {
        setHostedUrl(result.hostedUrl);
        setStep('hosted_waiting');
      } else if (result.clientSecret) {
        setClientSecret(result.clientSecret);
        setStep('embedded_checkout');
      } else {
        throw new Error('Stripe Checkout session did not return a valid client secret.');
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to start Stripe Checkout.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCompletion = useCallback(async () => {
    if (!activeSessionId) return;
    setBusy(true);
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
          `Stripe reports payment status as "${verification.paymentStatus}". Complete payment first, then click Verify.`
        );
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not verify payment status.'
      );
    } finally {
      setBusy(false);
    }
  }, [activeOrderId, activeSessionId, onClearCart]);

  const handleCancelCheckoutFlow = async () => {
    if (activeOrderId && step !== 'paid_receipt') {
      try {
        await cancelCustomerPendingOrder(activeOrderId);
      } catch {
        // Order may already be settled or cancelled
      }
    }
    setClientSecret(null);
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
      setClientSecret(null);
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
      <div
        className={`relative w-full ${
          step === 'embedded_checkout' ? 'max-w-2xl' : 'max-w-lg'
        } bg-[#FAF9F6] h-full flex flex-col shadow-2xl border-l border-stone-200 transition-transform duration-150`}
      >
        {/* Drawer Header */}
        <div className="px-6 py-4 bg-white border-b border-stone-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-stone-950">
              {step === 'bag' && `Your Counter Bag (${totalCount})`}
              {step === 'embedded_checkout' && `Stripe Checkout · ${activeOrderNumber}`}
              {step === 'hosted_waiting' && `Complete Payment · ${activeOrderNumber}`}
              {step === 'paid_receipt' && 'Payment Confirmed'}
            </h2>
            <p className="text-xs text-stone-500">
              {step === 'bag' && 'All prices settled in British Pounds (£ GBP)'}
              {step === 'embedded_checkout' &&
                'Encrypted live payment powered directly by Stripe'}
              {step === 'hosted_waiting' &&
                'Finish payment on the Stripe Checkout tab, then verify below'}
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
                    Add any £1.00–£5.00 dish or drink from our menu to test live Stripe
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

                  {/* Clear Bag Action */}
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

          {step === 'embedded_checkout' && clientSecret && stripePromise && (
            <div className="space-y-4">
              <div className="bg-white border border-stone-200/80 rounded-xl p-3 overflow-hidden">
                <EmbeddedCheckoutProvider
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    onComplete: () => {
                      void handleVerifyCompletion();
                    },
                  }}
                >
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              </div>

              <div className="flex items-center justify-between pt-2 text-xs text-stone-500">
                <button
                  type="button"
                  onClick={() => void handleCancelCheckoutFlow()}
                  className="font-medium text-stone-600 hover:text-stone-950 underline underline-offset-4 cursor-pointer"
                >
                  Cancel & Return to Bag
                </button>
                <button
                  type="button"
                  onClick={() => void handleVerifyCompletion()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 font-semibold text-emerald-900 hover:text-emerald-950 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                  <span>Verify Payment Status</span>
                </button>
              </div>
            </div>
          )}

          {step === 'hosted_waiting' && hostedUrl && (
            <div className="bg-white border border-stone-200/80 rounded-xl p-6 space-y-5">
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-stone-950">
                  Hosted Stripe Checkout Ready ({activeOrderNumber})
                </h3>
                <p className="text-sm text-stone-600 leading-relaxed">
                  Click the button below to open the official Stripe Checkout page in a new
                  browser tab. Once you complete payment, return here and click{' '}
                  <strong>Verify Payment</strong>.
                </p>
              </div>

              <a
                href={hostedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg transition-colors"
              >
                <span>Open Stripe Checkout Page</span>
                <ExternalLink className="w-4 h-4" />
              </a>

              <div className="pt-4 border-t border-stone-200 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void handleCancelCheckoutFlow()}
                  className="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-950 cursor-pointer"
                >
                  Cancel Order
                </button>
                <button
                  type="button"
                  onClick={() => void handleVerifyCompletion()}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-emerald-950 bg-emerald-950/10 hover:bg-emerald-950/15 rounded-lg cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                  <span>{busy ? 'Checking Stripe...' : 'I Have Paid · Verify Now'}</span>
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
                    Your live Stripe payment has been verified and sent to the kitchen.
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
                  <dt className="text-stone-500">Stripe Status</dt>
                  <dd className="font-semibold text-emerald-900">
                    Verified Paid ({receipt.paymentStatus})
                  </dd>
                </div>
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-stone-500">Payment Intent</dt>
                  <dd className="font-mono text-xs text-stone-700 truncate max-w-[220px]">
                    {receipt.paymentIntentId}
                  </dd>
                </div>
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-stone-500">Receipt Email</dt>
                  <dd className="text-xs text-stone-700 truncate max-w-[220px]">
                    {receipt.customerEmail}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => {
                    handleCloseDrawer();
                    onChangeView('user');
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 rounded-lg cursor-pointer"
                >
                  Track in User Panel
                </button>
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  className="px-4 py-2.5 text-sm font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Bag Footer */}
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
            ) : !stripePublishableKey ? (
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 leading-relaxed">
                Stripe environment variables are not configured yet. Add{' '}
                <code className="font-mono font-semibold">STRIPE_SECRET_KEY</code> and{' '}
                <code className="font-mono font-semibold">STRIPE_PUBLISHABLE_KEY</code> in
                AI Studio <strong>Settings → Secrets</strong> to enable live payments.
              </div>
            ) : (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => void handleStartCheckout('embedded')}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-950 hover:bg-emerald-900 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  <span>
                    {busy
                      ? 'Preparing Stripe Checkout...'
                      : `Pay ${formatGBP(totalPence)} via Stripe Checkout`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleStartCheckout('hosted')}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-stone-600 hover:text-stone-950 cursor-pointer"
                >
                  <span>Or open Hosted Stripe Checkout in a new tab</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
