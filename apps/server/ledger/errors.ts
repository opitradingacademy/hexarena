export class InsufficientBalanceError extends Error {
  constructor(userId: string, requested: number, available: number) {
    super(
      `insufficient balance for user ${userId}: requested ${requested}, available ${available}`,
    );
    this.name = "InsufficientBalanceError";
  }
}
