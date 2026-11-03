import { customAlphabet } from "nanoid";

// No 0/O/1/I, so codes are easy to read back over the phone.
export const generateReservationCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 7);
