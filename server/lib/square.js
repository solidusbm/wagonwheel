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

export { SquareError };
