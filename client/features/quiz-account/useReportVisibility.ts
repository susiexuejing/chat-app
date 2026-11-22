import {useEffect,useRef} from 'react';

type Options={hasProtectedReport:boolean;onHide:()=>void;onResume:()=>void};

// Only a previously rendered, protected result warrants revalidation.
// A guest returning from Messages keeps their in-memory answers and intent.
// The browser veil is applied synchronously before a page can be snapshotted.
export function useReportVisibility(options:Options) {
  const latest=useRef(options);
  latest.current=options;
  useEffect(()=>{
    if(typeof window==='undefined'||typeof document==='undefined') return;
    const style=document.createElement('style');
    style.textContent='html[data-ef-quiz-report-masked="1"] #ef-quiz-protected-report { visibility: hidden !important; }';
    document.head.append(style);
    let restore=false;
    const hide=()=>{
      if(!latest.current.hasProtectedReport&&!restore)return;
      restore=true;
      document.documentElement.dataset.efQuizReportMasked='1';
      latest.current.onHide();
    };
    const resume=()=>{
      if(!restore||document.visibilityState==='hidden')return;
      restore=false;
      latest.current.onResume();
    };
    const changed=()=>document.visibilityState==='hidden'?hide():resume();
    const show=(event:PageTransitionEvent)=>{if(event.persisted){hide();resume();}};
    window.addEventListener('pagehide',hide);
    window.addEventListener('pageshow',show);
    document.addEventListener('visibilitychange',changed);
    return()=>{
      style.remove();
      clearQuizReportVeil();
      window.removeEventListener('pagehide',hide);
      window.removeEventListener('pageshow',show);
      document.removeEventListener('visibilitychange',changed);
    };
  },[]);
}

export function clearQuizReportVeil() {
  if(typeof document!=='undefined') delete document.documentElement.dataset.efQuizReportMasked;
}
