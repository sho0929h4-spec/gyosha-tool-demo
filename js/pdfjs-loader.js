// js/pdfjs-loader.js — 重いライブラリを押したときに初めて読む（<script> を足す）。版は固定（jsdelivr）
//   loadPdfJs() → Promise<pdfjsLib>（仕入見積の PDF・段階④の図面で使う）／ loadXlsx() → Promise<XLSX>（仕入見積の Excel）
//   SheetJS は約900KB あるので、ページを開くたびには読まない
(function () {
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
  const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  window.PDFJS_CMAPS = PDFJS + 'cmaps/'; // 埋め込みの無い日本語の書体の PDF を読むため
  const loading = {};
  // 失敗したら次に押したときにもう一度読む
  function load(url, get) {
    if (get()) return Promise.resolve(get());
    if (!loading[url]) {
      loading[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => (get() ? resolve(get()) : reject(new Error('読み込めませんでした')));
        s.onerror = () => { s.remove(); reject(new Error('読み込めませんでした。電波の良い所でもう一度お試しください')); };
        document.head.appendChild(s);
      }).catch(e => { delete loading[url]; throw e; });
    }
    return loading[url];
  }
  window.loadPdfJs = () => load(PDFJS + 'build/pdf.min.js', () => window.pdfjsLib).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS + 'build/pdf.worker.min.js';
    return lib;
  });
  window.loadXlsx = () => load(XLSX_URL, () => window.XLSX);
})();
