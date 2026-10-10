declare module 'react-native-razorpay' {
  export interface RazorpayCheckoutOptions {
    key: string;
    order_id: string;
    /** In paise */
    amount: number;
    currency: string;
    name: string;
    description?: string;
    image?: string;
    prefill?: { name?: string; contact?: string; email?: string };
    theme?: { color?: string };
    [option: string]: unknown;
  }

  export interface RazorpaySuccess {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }

  /** Rejects with { code, description }; code 2 means the payment screen was closed. */
  const RazorpayCheckout: {
    open(options: RazorpayCheckoutOptions): Promise<RazorpaySuccess>;
  };
  export default RazorpayCheckout;
}
