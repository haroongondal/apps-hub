// Date.now() in base 36 (8 digits until 2059, padded to 9) plus 7 random digits: 16 in all, matching ITEM_ID.
export function newId(): string {
  let id = Date.now().toString(36).padStart(9, '0');
  for (let i = 0; i < 7; i++) id += Math.floor(Math.random() * 36).toString(36);
  return id;
}
