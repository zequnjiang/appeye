// This requests a browser download; it cannot confirm that a file was saved.
export function requestDownload(name, content, environment = globalThis) {
  const { document, URL, Blob, setTimeout } = environment;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Some browsers consume the object URL after dispatching the click event.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
