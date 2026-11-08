// js/pdfjs-loader.js — 重いライブラリを押したときに初めて読む（<script> を足す）。版は固定（jsdelivr）
//   loadPdfJs() → Promise<pdfjsLib>（仕入見積の PDF・段階④の図面で使う）／ loadXlsx() → Promise<XLSX>（仕入見積の Excel）／ loadTesseract() → Promise<Tesseract>（写真の文字認識）
//   SheetJS は約900KB あるので、ページを開くたびには読まない
//   改ざん検知（integrity）は付けない: 本体から worker・wasm・辞書・cmaps をさらに読み、そちらには integrity を付けられないため。版を固定して、CSP で取りに行ける先を jsdelivr と tessdata に限る
(function () {
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
  const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  // 日本語の辞書は軽い方（1.5MB。標準は16MB）。スマホで初めて読むときに取る。読んだ後は端末に残る
  window.TESS_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0_fast';
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
  window.loadTesseract = () => load(TESS_URL, () => window.Tesseract);
})();
