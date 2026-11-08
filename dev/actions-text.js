(async () => {
  const b64 = await __PDFORIENT__.convertBase64();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const text = tc.items.map((it) => it.str).join(' ');
  return {
    chars: text.length,
    items: tc.items.length,
    sample: text.slice(0, 200),
    hasInvoice: /Счет-фактура/i.test(text),
    hasSeller: /Ажур/.test(text),
  };
})()
