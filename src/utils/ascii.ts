export const ascii = {
  encode(str: string) {
    return new TextEncoder().encode(str);
  },
  decode(arr: Uint8Array) {
    return new TextDecoder().decode(arr);
  },
};
