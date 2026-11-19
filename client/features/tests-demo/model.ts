export type Question = { title: string; options: string[] };
export type Quiz = { id: string; title: string; subtitle: string; icon: 'pulse' | 'people-outline' | 'heart-outline'; questions: Question[]; results: { title: string; description: string; suggestion: string }[] };
const options = ['先停下来，给自己一点空间', '找信任的人聊聊', '先处理眼前的一件小事'];
const results = [
  { title: '先给自己一点空间', description: '在这个示例中，你更倾向先独处整理，再处理眼前的事。', suggestion: '留一分钟，写下此刻最想解决的一件小事。' },
  { title: '让连接成为支持', description: '在这个示例中，你更倾向通过交流，慢慢整理自己的想法。', suggestion: '想想哪位熟悉的人能陪你聊一会儿。' },
  { title: '从一件小事开始', description: '在这个示例中，你更倾向从具体的小行动找到节奏。', suggestion: '选一件容易完成的小事，不必一下解决所有问题。' },
];
export const quizzes: Quiz[] = [
  { id: 'stress', title: '压力反应', subtitle: '看看面对压力时，你会如何回应。', icon: 'pulse', questions: ['遇到压力时，你通常会怎么做？', '事情突然变多时，哪种方式更适合你？', '计划被打乱后，你会先做什么？', '忙碌了一天，你想如何休息？', '遇到暂时解不开的问题，你会怎么做？', '重新出发前，你更需要什么？'].map(title => ({ title, options })), results },
  { id: 'boundaries', title: '人际边界', subtitle: '留意相处中的距离与自己的需要。', icon: 'people-outline', questions: ['收到一个不方便答应的邀请，你会怎样回应？', '别人临时请你帮忙，你想怎么做？', '想保留独处时间时，你会怎么表达？', '意见不同时，你更想如何沟通？', '对方没有理解你的意思，你会怎么做？', '相处之后，你想如何整理感受？'].map(title => ({ title, options: ['先想清楚自己的需要', '和对方商量一个办法', '先说清楚自己能做的部分'] })), results: [
    { title: '先听听自己的需要', description: '这个示例呈现了先辨认自身需要的回应方式。', suggestion: '试着用一句话说明你现在需要的空间。' },
    { title: '在沟通中寻找空间', description: '这个示例呈现了通过商量寻找相处方式的倾向。', suggestion: '用“我希望……”开始一次简短表达。' },
    { title: '把边界说具体', description: '这个示例呈现了用具体范围表达边界的方式。', suggestion: '想清楚这次能做什么，以及暂时不能做什么。' },
  ] },
  { id: 'recovery', title: '情绪恢复', subtitle: '发现让自己慢慢恢复节奏的方式。', icon: 'heart-outline', questions: ['一天不太顺利时，你想怎样放松？', '心里有些乱时，你更想做什么？', '一次争执后，你想怎样缓一缓？', '周末留给自己，你会怎样安排？', '想恢复精神时，你会从哪里开始？', '准备结束一天时，你更需要什么？'].map(title => ({ title, options })), results },
];
export type View = 'list' | 'intro' | 'question' | 'login' | 'result';
export type LoadState = 'ready' | 'loading' | 'empty' | 'error';
export type State = { view: View; selected: string | null; answers: Record<string, number[]>; question: number; identity: 'A' | 'B' | null; finished: { quiz: string; at: string } | null; completed: Record<string, { quiz: string; at: string; owner: 'A' | 'B'; answers: number[] }>; loginReturn: View; notice: string; catalog: LoadState; result: LoadState };
export const initialState = (): State => ({ view: 'list', selected: null, answers: {}, question: 0, identity: null, finished: null, completed: {}, loginReturn: 'list', notice: '', catalog: 'ready', result: 'ready' });
export type Action = { type: 'select'; id: string } | { type: 'start' } | { type: 'answer'; index: number } | { type: 'next'; at: string } | { type: 'previous' } | { type: 'list' } | { type: 'login' } | { type: 'cancel-login' } | { type: 'authenticate'; identity: 'A' | 'B'; outcome: 'success' | 'invalid' | 'expired' | 'failure'; at: string } | { type: 'logout' } | { type: 'reset' } | { type: 'result'; id?: string } | { type: 'restart' } | { type: 'fixture'; target: 'catalog' | 'result'; value: LoadState };
export function complete(state: State, quiz: Quiz) { return quiz.questions.every((q, i) => Number.isInteger(state.answers[quiz.id]?.[i]) && state.answers[quiz.id][i] >= 0 && state.answers[quiz.id][i] < q.options.length); }
// Completed results are immutable snapshots, separate from in-progress answers.
// Only the latest snapshot per test survives within the current fictional identity.
export function resultFor(state: State, id: string, catalog = quizzes) {
  const quiz = catalog.find(q => q.id === id);
  const saved = state.completed[id];
  if (!quiz || !state.identity || saved?.owner !== state.identity || saved.quiz !== id ||
      !quiz.questions.every((q, i) => Number.isInteger(saved.answers[i]) && saved.answers[i] >= 0 && saved.answers[i] < q.options.length)) return null;
  const counts = quiz.results.map((_, i) => saved.answers.filter(a => a === i).length);
  return { quiz, ...quiz.results[counts.indexOf(Math.max(...counts))], at: saved.at };
}
export function currentResult(state: State, catalog = quizzes) {
  return state.selected ? resultFor(state, state.selected, catalog) : null;
}
export function reduce(state: State, action: Action, catalog = quizzes): State {
  const quiz = catalog.find(q => q.id === state.selected);
  switch (action.type) {
    case 'select': return catalog.some(q => q.id === action.id) ? { ...state, selected: action.id, view: 'intro', notice: '' } : state;
    case 'start': {
      if (!quiz) return state;
      const unanswered = quiz.questions.findIndex((_, i) => state.answers[quiz.id]?.[i] === undefined);
      // A fully answered draft resumes at completion; an existing result opens for editing.
      const question = unanswered >= 0 ? unanswered : resultFor(state, quiz.id, catalog) ? 0 : quiz.questions.length - 1;
      return { ...state, view: 'question', question, notice: '' };
    }
    case 'answer': return quiz && state.view === 'question' && Number.isInteger(action.index) && action.index >= 0 && action.index < quiz.questions[state.question].options.length ? { ...state, answers: { ...state.answers, [quiz.id]: Object.assign([...(state.answers[quiz.id] || [])], { [state.question]: action.index }) }, finished: state.finished?.quiz === quiz.id ? null : state.finished, notice: '' } : state;
    case 'previous': return state.view === 'question' ? { ...state, view: state.question > 0 ? 'question' : 'intro', question: Math.max(0, state.question - 1), notice: '' } : state;
    case 'next':
      if (!quiz || state.view !== 'question') return state;
      if (state.answers[quiz.id]?.[state.question] === undefined) return { ...state, notice: '请先选择一个选项。' };
      if (state.question < quiz.questions.length - 1) return { ...state, question: state.question + 1, notice: '' };
      if (!complete(state, quiz)) return { ...state, notice: '还有题目未完成，请返回检查。' };
      return state.identity ? { ...state, view: 'result', result: 'ready', finished: { quiz: quiz.id, at: action.at }, completed: { ...state.completed, [quiz.id]: { quiz: quiz.id, at: action.at, owner: state.identity, answers: [...state.answers[quiz.id]] } }, notice: '' } : { ...state, view: 'login', loginReturn: 'question', finished: { quiz: quiz.id, at: action.at }, notice: '' };
    case 'list': return { ...state, view: 'list', notice: '' };
    case 'login': return state.view === 'login' ? state : { ...state, loginReturn: state.view, view: 'login', notice: '' };
    case 'cancel-login': return { ...state, view: state.loginReturn, notice: '' };
    case 'authenticate': {
      if (state.view !== 'login') return state;
      if (action.outcome !== 'success') return { ...state, notice: { invalid: '模拟验证码无效，答案仍保留。', expired: '模拟验证码已过期，答案仍保留。', failure: '模拟登录未成功，答案仍保留。' }[action.outcome] };
      if (state.identity && state.identity !== action.identity) return { ...initialState(), identity: action.identity, notice: '已切换演示身份，上一身份的答案和结果已清除。' };
      return quiz && complete(state, quiz) && state.finished?.quiz === quiz.id ? { ...state, identity: action.identity, view: 'result', result: 'ready', completed: { ...state.completed, [quiz.id]: { quiz: quiz.id, at: state.finished.at, owner: action.identity, answers: [...state.answers[quiz.id]] } }, notice: '' } : { ...state, identity: action.identity, view: state.loginReturn === 'login' || state.loginReturn === 'result' ? 'list' : state.loginReturn, notice: '' };
    }
    case 'reset': return initialState();
    case 'logout': return { ...initialState(), notice: '已退出演示，答案和结果已清除。' };
    case 'restart': return quiz && state.view === 'result' ? { ...state, view: 'question', question: 0, answers: { ...state.answers, [quiz.id]: [] }, finished: null, notice: '' } : state;
    case 'result': {
      const id = action.id || state.selected;
      return id && resultFor(state, id, catalog) ? { ...state, selected: id, view: 'result', result: 'ready', notice: '' } : { ...state, notice: '这个测试还没有结果，请先完成测试。' };
    }
    case 'fixture': return { ...state, [action.target]: action.value, notice: '' };
  }
}
