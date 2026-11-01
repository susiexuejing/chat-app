import {KINDS} from './detail.mjs';
export const escapeText = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderDetail(state){
 const demo='<p class="eyebrow">DEMO · 本地合成内容</p>';
 if(state.status==='idle')return demo+'<h1>当前理解与线索</h1><p>选择一个演示场景开始。</p>';
 if(state.status==='loading')return demo+'<div role="status"><h1>正在读取这条模式…</h1><p>当前没有展示其他模式的内容。</p></div>';
 if(state.status==='error'){
  const auth=state.error==='unauthenticated',missing=state.error==='not_found';
  return demo+`<div role="alert"><h1>${auth?'请先登录':missing?'找不到这条模式':'未能加载这条模式'}</h1><p>${auth?'当前演示未登录，没有读取任何模式。':missing?'模式不存在，或当前账户无权查看。':'读取暂时不可用，未显示先前内容。你可以重试或离开。'}</p></div>${!auth&&!missing?'<button id="retry" data-testid="retry">重试读取</button>':''}<button class="secondary" id="leave" data-testid="leave">离开详情</button>`;
 }
 const p=state.pattern;
 const status=p.decision==='confirmed'?'演示／已确认（合成状态）':'演示／待确认';
 let body=demo+`<span class="badge" data-testid="decision">${status}</span><h1 data-testid="pattern-name">${escapeText(p.name?.trim()?p.name:'名称尚未提供')}</h1><h2>我的当前理解</h2><p class="understanding" data-testid="understanding">${escapeText(p.currentUnderstanding?.trim()?p.currentUnderstanding:'当前理解尚未提供。')}</p><p class="quiet">这是一种可以核对的理解，不是诊断。所有内容均为虚构演示，不代表你的真实经历。</p><button id="toggle" data-testid="toggle" aria-expanded="${state.expanded}" aria-controls="clues">${state.expanded?'收起线索':'了解更多'}</button>`;
 if(state.expanded){
  body+='<section id="clues" data-testid="clues" aria-label="已有线索"><h2>已有线索</h2>';
  if(!p.clues.length)body+='<p>尚无线索；不推测原因或补写解释。</p>';
  for(const clue of p.clues)body+=`<article class="clue"><h3>${KINDS[clue.kind]}</h3><p>${escapeText(clue.text)}</p><p class="source">来源：${escapeText(clue.source||'未提供')}</p><p class="source">用户确认：${clue.userConfirmed===true?'已确认（合成演示状态）':clue.userConfirmed===false?'尚未确认':'未知／未提供'}</p></article>`;
  body+='</section>';
 }
 return body+'<div class="exit"><button class="secondary" id="leave" data-testid="leave">离开详情</button></div>';
}
