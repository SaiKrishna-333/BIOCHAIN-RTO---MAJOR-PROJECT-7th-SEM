// masking.js
//
// An identity number belongs to one person. Everyone else - an officer, a
// counterparty, another account holder - may be shown enough of it to confirm
// that the record points at the right person, and nothing more. This module is
// the single place that decides how much "nothing more" looks like, so no route
// has to invent its own masking and no screen can accidentally print the full
// number of somebody other than the viewer.

/**
 * "XXXX XXXX 4321" for a twelve-digit number, fully hidden for anything else.
 * The last four digits are enough to recognise a person in a list.
 */
export const maskAadhaar = (aadhaar) => {
    if (!aadhaar) return null;
    const digits = String(aadhaar).replace(/\D/g, "");
    if (digits.length !== 12) return "XXXX XXXX XXXX";
    return `XXXX XXXX ${digits.slice(8)}`;
};

/**
 * Mask the identity number carried by a user that has just been read for a
 * display payload. Accepts a plain object or a populated Mongoose document and
 * returns it with the number replaced. These are read-only response shapes: no
 * caller saves the document afterwards.
 */
export const maskUserAadhaar = (user) => {
    if (!user) return user;
    user.aadhaarNumber = maskAadhaar(user.aadhaarNumber);
    return user;
};
