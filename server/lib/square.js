import { SquareClient, SquareEnvironment, SquareError } from "square";

let client;

function getClient() {
  if (!client) {
    if (!process.env.SQUARE_ACCESS_TOKEN) {
      throw new Error("SQUARE_ACCESS_TOKEN is not set");
    }
    client = new SquareClient({
      token: process.env.SQUARE_ACCESS_TOKEN,
      environment:
        process.env.SQUARE_ENVIRONMENT === "production"
          ? SquareEnvironment.Production
          : SquareEnvironment.Sandbox,
    });
  }
  return client;
}

// Charges a card previously tokenized by the Square Web Payments SDK.
// Returns { paymentId } on success, throws on failure.
export async function chargeCard({ sourceId, amountCents, idempotencyKey, referenceId, note }) {
  const square = getClient();
  const response = await square.payments.create({
    sourceId,
    idempotencyKey,
    amountMoney: {
      amount: BigInt(amountCents),
      currency: "USD",
    },
    locationId: process.env.SQUARE_LOCATION_ID,
    referenceId,
    note,
    autocomplete: true,
  });

  const payment = response.payment;
  if (!payment || payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
    throw new Error(`Unexpected payment status: ${payment?.status}`);
  }
  return { paymentId: payment.id };
}

/* Refunds part or all of a captured payment. Square is the source of truth for what was actually
   refunded, so the caller stores what comes back rather than what it asked for. Refunds are
   irreversible -- there is no un-refund -- which is why the admin route makes the caller state the
   amount explicitly instead of defaulting to "everything". */
export async function refundPayment({ paymentId, amountCents, idempotencyKey, reason }) {
  const square = getClient();
  const response = await square.refunds.refundPayment({
    paymentId,
    idempotencyKey,
    amountMoney: { amount: BigInt(amountCents), currency: "USD" },
    reason,
  });
  const refund = response.refund;
  if (!refund) throw new Error("Square returned no refund object");
  if (refund.status === "FAILED") throw new Error(`Square refund failed: ${refund.status}`);
  return {
    refundId: refund.id,
    status: refund.status,
    amountCents: Number(refund.amountMoney?.amount ?? amountCents),
  };
}

export { SquareError };
