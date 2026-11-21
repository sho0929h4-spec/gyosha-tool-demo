// js/pdfjs-loader.js — 重いライブラリを押したときに初めて読む（<script> を足す）。版は固定（jsdelivr・cdn.sheetjs.com）
//   loadPdfJs() → Promise<pdfjsLib>（仕入見積の PDF・段階④の図面で使う）／ loadXlsx() → Promise<XLSX>（仕入見積の Excel）／ loadTesseract() → Promise<Tesseract>（写真の文字認識）
//   SheetJS は約900KB あるので、ページを開くたびには読まない
//   改ざん検知（integrity）は本体（pdf.min.js・tesseract.min.js・SheetJS）にだけ付ける（ハッシュは取ってきたファイルから計算: curl -s URL | openssl dgst -sha384 -binary | openssl base64 -A）。
//   本体がさらに読む worker・wasm・辞書・cmaps には integrity を付けられないので、版を固定して、CSP で取りに行ける先を jsdelivr・sheetjs と tessdata の版のフォルダに限る
(function () {
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
  const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'; // 0.18.5 は既知の弱点（CVE-2023-30533・CVE-2024-22363）。npm には新しい版が無いので SheetJS の CDN から
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const SRI = {
    pdf: 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e',
    xlsx: 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT',
    tess: 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F'
  };
  // 日本語の辞書は軽い方（1.5MB。標準は16MB）。スマホで初めて読むときに取る。読んだ後は端末に残る
  window.TESS_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0_fast';
  window.PDFJS_CMAPS = PDFJS + 'cmaps/'; // 埋め込みの無い日本語の書体の PDF を読むため
  const loading = {};
  // 失敗したら次に押したときにもう一度読む
  function load(url, get, integrity) {
    if (get()) return Promise.resolve(get());
    if (!loading[url]) {
      loading[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.integrity = integrity;
        s.crossOrigin = 'anonymous';
        s.onload = () => (get() ? resolve(get()) : reject(new Error('読み込めませんでした')));
        s.onerror = () => { s.remove(); reject(new Error('読み込めませんでした。電波の良い所でもう一度お試しください')); };
        document.head.appendChild(s);
      }).catch(e => { delete loading[url]; throw e; });
    }
    return loading[url];
  }
  window.loadPdfJs = () => load(PDFJS + 'build/pdf.min.js', () => window.pdfjsLib, SRI.pdf).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS + 'build/pdf.worker.min.js';
    return lib;
  });
  window.loadXlsx = () => load(XLSX_URL, () => window.XLSX, SRI.xlsx);
  window.loadTesseract = () => load(TESS_URL, () => window.Tesseract, SRI.tess);
})();
