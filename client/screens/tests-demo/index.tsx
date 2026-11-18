import React, { useEffect, useReducer, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { complete, currentResult, initialState, quizzes, reduce, type State, type Action, type LoadState } from '@/features/tests-demo/model';

function Button({ children, onPress, secondary = false, selected, testID }: { children: React.ReactNode; onPress: () => void; secondary?: boolean; selected?: boolean; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={selected === undefined ? undefined : { selected }} aria-pressed={selected} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, selected && styles.selected, pressed && styles.pressed]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{children}</Text></Pressable>;
}
export default function TestsDemo() {
  const [state, dispatch] = useReducer((state: State, action: Action) => reduce(state, action), undefined, initialState);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resetOnLeave = () => dispatch({ type: 'reset' });
    const resetOnReturn = (event: PageTransitionEvent) => { if (event.persisted) resetOnLeave(); };
    window.addEventListener('pagehide', resetOnLeave);
    window.addEventListener('pageshow', resetOnReturn);
    return () => {
      window.removeEventListener('pagehide', resetOnLeave);
      window.removeEventListener('pageshow', resetOnReturn);
    };
  }, []);
  const [loginIdentity, setLoginIdentity] = useState<'A' | 'B'>('A');
  const [loginOutcome, setLoginOutcome] = useState<'success' | 'invalid' | 'expired' | 'failure'>('success');
  const [showFixtures, setShowFixtures] = useState(false);
  const quiz = quizzes.find(q => q.id === state.selected);
  const result = currentResult(state);
  const awaitingResult = !!quiz && complete(state, quiz) && state.finished?.quiz === quiz.id;
  const now = () => new Date().toISOString();
  const list = () => dispatch({ type: 'list' });
  const openLogin = () => { setLoginIdentity(state.identity || 'A'); setLoginOutcome('success'); dispatch({ type: 'login' }); };
  const loadingPanel = (target: 'catalog' | 'result', status: LoadState) => <View style={styles.panel}>
    <Text style={styles.subheading}>{status === 'loading' ? '正在展示加载状态…' : status === 'empty' ? '这里暂时没有内容' : '暂时无法展示内容'}</Text>
    <Text style={styles.muted}>这是本地演示状态，未发送请求。</Text>
    <Button onPress={() => dispatch({ type: 'fixture', target, value: 'ready' })}>{status === 'error' ? '本地重试' : '返回正常状态'}</Button>
    <Button secondary onPress={list}>返回测试</Button>
  </View>;
  // A new logical page must not inherit the previous page's inner scroll offset.
  const screenKey = `${state.view}:${state.selected || ''}:${state.view === 'question' ? state.question : ''}`;
  return <Screen key={screenKey} backgroundColor="#FFFFFF"><View style={styles.container}>
    <View style={styles.header}>
      {state.view === 'list' ? <Text style={styles.brand}>EmotionFlow</Text> : <Pressable accessibilityRole="button" accessibilityLabel={state.view === 'login' ? '取消登录' : '返回测试'} onPress={() => state.view === 'login' ? dispatch({ type: 'cancel-login' }) : list()} style={styles.back}><Ionicons name="arrow-back" size={24} color="#222" /><Text style={styles.body}>测试</Text></Pressable>}
      {state.view !== 'login' && <Pressable accessibilityRole="button" onPress={openLogin} style={styles.link}><Text style={styles.orange}>{state.identity ? `演示身份 ${state.identity}` : '登录'}</Text></Pressable>}
    </View>
    <Text style={styles.demoLabel}>前端演示 · 模拟数据 · 未连接服务</Text>
    {state.view === 'list' && <>
      <Text accessibilityRole="header" style={styles.title}>测试</Text><Text style={styles.subtitle}>留几分钟，了解自己。</Text>
      <View style={styles.tabs}><View style={styles.activeTab}><Text style={styles.green}>全部测试</Text></View><Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'result' })} style={styles.tab}><Text style={styles.body}>本次结果</Text></Pressable></View>
      {state.catalog !== 'ready' ? loadingPanel('catalog', state.catalog) : quizzes.map(q => <Pressable key={q.id} accessibilityRole="button" accessibilityLabel={`${q.title}，${q.questions.length}题，约3分钟`} onPress={() => dispatch({ type: 'select', id: q.id })} style={styles.card}>
        <Ionicons name={q.icon} size={30} color="#587B28" /><View style={styles.cardCopy}><Text style={styles.subheading}>{q.title}</Text><Text style={styles.muted}>{q.subtitle}</Text><Text style={styles.meta}>{q.questions.length} 题 · 约 3 分钟</Text></View><Ionicons name="chevron-forward" size={20} color="#777" />
      </Pressable>)}
      <Text style={styles.centerNote}>完成后模拟登录查看结果</Text>
    </>}
    {state.view === 'intro' && quiz && <>
      <Ionicons name={quiz.icon} size={42} color="#587B28" /><Text accessibilityRole="header" style={styles.title}>{quiz.title}</Text><Text style={styles.subtitle}>{quiz.subtitle}</Text>
      <Text style={styles.meta}>{quiz.questions.length} 题 · 约 3 分钟</Text><View style={styles.panel}><Text style={styles.body}>没有标准答案，选择更接近你的选项即可。</Text><Text style={styles.muted}>完成后需要模拟登录查看示例结果。这些是虚构演示题目，不是正式测评或诊断。</Text></View>
      <Button onPress={() => dispatch({ type: 'start' })}>{state.answers[quiz.id]?.length ? '继续本次测试' : '开始测试'}</Button><Button secondary onPress={list}>返回测试列表</Button>
    </>}
    {state.view === 'question' && quiz && <>
      <Text accessibilityRole="header" style={styles.title}>{quiz.title}</Text><Text style={styles.progressText}>{state.question + 1} / {quiz.questions.length}</Text>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: quiz.questions.length, now: state.question + 1 }} aria-valuemin={0} aria-valuemax={quiz.questions.length} aria-valuenow={state.question + 1} style={styles.progress}><View style={[styles.progressFill, { width: `${((state.question + 1) / quiz.questions.length) * 100}%` }]} /></View>
      <Text style={styles.question}>{quiz.questions[state.question].title}</Text>
      {quiz.questions[state.question].options.map((option, index) => <Button key={option} secondary selected={state.answers[quiz.id]?.[state.question] === index} testID={`answer-${index}`} onPress={() => dispatch({ type: 'answer', index })}>{state.answers[quiz.id]?.[state.question] === index ? '●' : '○'}  {option}</Button>)}
      <View style={styles.spacer} /><Button testID="next-question" onPress={() => dispatch({ type: 'next', at: now() })}>{state.question === quiz.questions.length - 1 ? '完成测试' : '下一题'}</Button><Button secondary onPress={() => dispatch({ type: 'previous' })}>{state.question === 0 ? '返回说明' : '上一题'}</Button>
    </>}
    {state.view === 'login' && <>
      <View style={styles.loginIntro}><Ionicons name="checkmark-circle-outline" size={58} color="#587B28" /><Text accessibilityRole="header" style={styles.title}>{awaitingResult ? '测试已完成' : '演示登录'}</Text><Text style={styles.subtitle}>{awaitingResult ? '模拟登录后，查看本次示例结果。' : '选择一个虚构身份，体验测试流程。'}</Text></View>
      <Text style={styles.subheading}>选择虚构身份</Text><View style={styles.row}>{(['A', 'B'] as const).map(id => <View key={id} style={styles.flex}><Button secondary selected={loginIdentity === id} onPress={() => setLoginIdentity(id)}>演示身份 {id}</Button></View>)}</View>
      <Text style={styles.muted}>不需要手机号或验证码，不发送短信，不创建真实账号。</Text>
      {state.identity && loginIdentity !== state.identity && <Text style={styles.notice}>切换身份将清除上一身份的演示答案和结果。</Text>}
      <View style={styles.spacer} /><Button testID="simulate-login" onPress={() => dispatch({ type: 'authenticate', identity: loginIdentity, outcome: loginOutcome, at: now() })}>模拟登录{awaitingResult ? '并查看结果' : ''}</Button>
      <Button secondary onPress={() => dispatch({ type: 'cancel-login' })}>取消，返回当前流程</Button>
    </>}
    {state.view === 'result' && (state.result !== 'ready' ? loadingPanel('result', state.result) : result ? <>
      <Text accessibilityRole="header" style={styles.title}>测试结果</Text><Text style={styles.subtitle}>{result.quiz.title} · 示例</Text>
      <View style={styles.resultCard}><Ionicons name="leaf-outline" size={30} color="#587B28" /><Text style={styles.resultTitle}>{result.title}</Text><Text style={styles.body}>{result.description}</Text></View>
      <View style={styles.panel}><Text style={styles.subheading}>试试这样做</Text><Text style={styles.body}>{result.suggestion}</Text></View>
      <Text style={styles.meta}>本次完成：{new Date(result.at).toLocaleString('zh-CN')}</Text><Text style={styles.muted}>仅本次内存结果，未保存；不是正式测评，不构成诊断。</Text>
      <Button onPress={list}>返回测试</Button><Button secondary onPress={() => { dispatch({ type: 'select', id: result.quiz.id }); }}>返回说明，修改答案</Button>
    </> : <><Text style={styles.notice}>本次结果已不可用，请重新开始。</Text><Button onPress={list}>返回测试</Button></>)}
    {!!state.notice && <Text accessibilityRole="alert" style={styles.notice}>{state.notice}</Text>}
    <Text style={styles.footer}>示例内容 · 非正式测评{ '\n' }答案与结果只在当前页面内存中保留，刷新或离开后重置。</Text>
    {state.identity && <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'logout' })} style={styles.link}><Text style={styles.muted}>退出演示并清除本次内容</Text></Pressable>}
    <Pressable accessibilityRole="button" onPress={() => setShowFixtures(!showFixtures)} style={styles.link}><Text style={styles.meta}>{showFixtures ? '收起' : '展开'}本地状态演示</Text></Pressable>
    {showFixtures && <View style={styles.fixture}>
      <Text style={styles.muted}>仅切换本地 UI，不联网。</Text>
      {state.view === 'list' || state.view === 'result' ? <View style={styles.row}>{(['loading', 'empty', 'error', 'ready'] as const).map((v, i) => <Pressable key={v} accessibilityRole="button" onPress={() => dispatch({ type: 'fixture', target: state.view === 'list' ? 'catalog' : 'result', value: v })} style={styles.fixtureButton}><Text>{['加载', '空', '失败', '正常'][i]}</Text></Pressable>)}</View> : null}
      {state.view === 'login' && <View style={styles.row}>{(['success', 'invalid', 'expired', 'failure'] as const).map((v, i) => <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: loginOutcome === v }} aria-pressed={loginOutcome === v} onPress={() => setLoginOutcome(v)} style={[styles.fixtureButton, loginOutcome === v && styles.selected]}><Text>{['成功', '无效码', '过期', '失败'][i]}</Text></Pressable>)}</View>}
    </View>}
  </View></Screen>;
}
const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 18, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48 }, brand: { fontSize: 22, fontWeight: '700', color: '#171B16' }, back: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }, link: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }, orange: { color: '#BA4900', fontSize: 16 },
  demoLabel: { color: '#686D63', fontSize: 11, marginBottom: 24, marginTop: 8 }, title: { fontSize: 32, fontWeight: '700', color: '#171B16', marginVertical: 8 }, subtitle: { fontSize: 17, color: '#5D6258', lineHeight: 26, marginBottom: 20 },
  body: { fontSize: 16, color: '#31372B', lineHeight: 25 }, muted: { fontSize: 14, color: '#666C60', lineHeight: 23 }, meta: { fontSize: 12, color: '#69705F', lineHeight: 20 }, subheading: { fontSize: 19, fontWeight: '600', color: '#20261B', marginBottom: 4 },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: '#D9DED2', borderRadius: 28, marginVertical: 12 }, tab: { flex: 1, padding: 12, alignItems: 'center' }, activeTab: { flex: 1, padding: 12, borderRadius: 28, backgroundColor: '#ECF3DF', alignItems: 'center' }, green: { color: '#41651A', fontSize: 16, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: '#E5E8E0' }, cardCopy: { flex: 1 }, centerNote: { textAlign: 'center', color: '#666C60', marginVertical: 28 },
  panel: { gap: 10, marginVertical: 24 }, button: { backgroundColor: '#CF4D00', borderRadius: 26, paddingVertical: 15, paddingHorizontal: 20, minHeight: 52, justifyContent: 'center', marginVertical: 6 }, buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', textAlign: 'center' }, secondary: { backgroundColor: '#FFFFFF', borderColor: '#D3D8CC', borderWidth: 1, borderRadius: 12 }, secondaryText: { color: '#30372A', fontSize: 16 }, selected: { backgroundColor: '#F0F5E7', borderColor: '#658D34', borderWidth: 1 }, pressed: { opacity: 0.7 },
  progressText: { textAlign: 'right', color: '#606659', marginTop: 12, marginBottom: 8 }, progress: { height: 6, backgroundColor: '#E8EBE3', borderRadius: 4 }, progressFill: { height: 6, backgroundColor: '#587B28', borderRadius: 4 }, question: { fontSize: 23, fontWeight: '600', color: '#20261B', lineHeight: 34, marginTop: 28, marginBottom: 22 }, spacer: { height: 22 }, loginIntro: { alignItems: 'center', marginVertical: 24 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, flex: { flex: 1, minWidth: 110 }, resultCard: { backgroundColor: '#F1F6E9', borderRadius: 18, padding: 22, gap: 12, marginVertical: 18 }, resultTitle: { fontSize: 23, fontWeight: '600', color: '#26341A' }, notice: { color: '#8B4310', backgroundColor: '#FFF5E9', padding: 14, borderRadius: 10, lineHeight: 23, marginVertical: 12 }, footer: { textAlign: 'center', color: '#74796D', fontSize: 12, lineHeight: 21, marginTop: 30 }, fixture: { borderWidth: 1, borderColor: '#E4E7DF', padding: 12, borderRadius: 12, gap: 10 }, fixtureButton: { minHeight: 44, padding: 10, backgroundColor: '#F4F5F1', borderRadius: 8 },
});
