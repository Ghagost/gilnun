import { dirKo, distance, fmtDist, bearing } from '../geo';
import { fmtDateKo, fmtHM, isoDate, wallTime } from '../format';
import { mapApi } from '../map/instance';
import { geo } from '../store/geo';
import { places } from '../store/places';
import { runtime } from '../store/runtime';
import { tripStore } from '../store/trip';
import { settings } from '../store/settings';

export function fxRate(): number {
  const m = Number(settings().fxManual);
  if (m > 0) return m;
  return runtime().fx?.rate || 9.0;
}

export function jstNowText(): string {
  const now = new Date();
  return `${fmtDateKo(now)} ${fmtHM(now)} (일본 시각)`;
}

export function contextBlock(): string {
  const L: string[] = [`- 지금: ${jstNowText()}`];
  const g = geo();
  if (g.me) L.push(`- 내 위치: ${g.me.lat.toFixed(5)}, ${g.me.lng.toFixed(5)} (정확도 ±${Math.round(g.me.acc)}m)${g.area?.label ? ` · ${g.area.label} 부근` : ''}`);
  else L.push('- 내 위치: 아직 모름 (GPS 대기 중이거나 꺼짐)');
  const mc = mapApi.center();
  if (mc && (!g.me || distance(g.me, mc) > 600)) L.push(`- 사용자가 보고 있는 지도 중심: ${mc.lat.toFixed(5)}, ${mc.lng.toFixed(5)}`);
  if (g.heading != null) L.push(`- 휴대폰 방향: ${dirKo(g.heading)} (${Math.round(g.heading)}°)`);
  const ps = places();
  if (ps.dest) {
    const d = g.me ? distance(g.me, ps.dest) : null;
    L.push(`- 목적지: ${ps.refOf[ps.dest.id] ? ps.refOf[ps.dest.id] + ' ' : ''}${ps.dest.name}${ps.dest.nameLocal ? ` (${ps.dest.nameLocal})` : ''}${d != null ? ` · 직선 ${fmtDist(d)}, ${dirKo(bearing(g.me!, ps.dest))}쪽` : ''}`);
  }
  const shown = ps.markers.slice(-10).map(id => ps.byId[id]).filter(Boolean);
  if (shown.length) L.push(`- 지도에 표시된 장소: ${shown.map(p => `${ps.refOf[p.id]} ${p.name}${p.nameLocal ? `(${p.nameLocal})` : ''}`).join(', ')}`);
  const ts = tripStore();
  const today = isoDate(new Date());
  const trip = ts.trips.find(t => t.id === ts.activeTripId) || ts.trips.find(t => t.start <= today && t.end >= today);
  if (trip) {
    const day = trip.days.find(d => d.date === today);
    L.push(`- 여행 일정: "${trip.title}" ${trip.start}~${trip.end}${trip.city ? ` (${trip.city})` : ''}`);
    if (day?.stops.length) L.push(`- 오늘 일정: ${day.stops.map(s => `${s.time ? s.time + ' ' : ''}${s.place.name}`).join(' → ')}`);
  }
  const up = ts.reservations
    .filter(r => r.status !== 'cancelled' && r.date >= today)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
    .slice(0, 3);
  if (up.length) L.push(`- 다가오는 예약: ${up.map(r => `${r.date}${r.time ? ' ' + r.time : ''} ${r.title}${r.people ? ` ${r.people}명` : ''}`).join(' / ')}`);
  const w = runtime().weather;
  if (w?.current?.temp != null) L.push(`- 현재 날씨: ${Math.round(w.current.temp)}°C${w.hours?.some(h => (h.pop ?? 0) >= 50) ? ', 몇 시간 안에 비 올 가능성 높음' : ''}`);
  L.push(`- 환율: 1엔 ≈ ${fxRate().toFixed(2)}원`);
  const cfg = runtime().config;
  L.push(`- 앱 기능: 일본 열차 실시간 경로 ${cfg?.transit ? '사용 가능(get_directions)' : '없음 → 구글지도 버튼 안내'}, 지도 ${runtime().engine === 'google' ? '구글 지도' : '무료 지도(OSM)'}`);
  return `[지금 상황]\n${L.join('\n')}`;
}

export function chatSystem(): string {
  return `너는 '길눈'이라는 일본 여행 지도 앱의 AI 길잡이야. 사용자는 일본을 여행 중이거나 여행을 준비하는 한국인이고, 휴대폰으로 보면서 이동 중일 수 있어.

답변 원칙
- 한국어로, 짧고 바로 행동할 수 있게. 결론을 먼저, 필요하면 번호 단계로. 인사말·사족은 빼.
- 일본 지명·역명·가게 이름은 일본어 원문과 한국어 읽기를 같이 써. 예: 新宿駅(신주쿠역). 현지 표지판과 맞춰 볼 수 있게.
- 장소를 추천하거나 언급하면 도구로 지도에 표시해. 주변 시설·맛집은 search_places, 좌표를 지어내지 마.
- 도구 결과의 ref(P1, P2…)를 답변에 "(P3)"처럼 적어. 앱이 그 번호를 지도와 연결해.
- 사용자가 어딘가 가려고 하면 set_destination으로 목적지를 정하고, 가는 법을 물으면 get_directions를 써.
- 대중교통 안내: 노선(한국어+일본어), 타는 역과 방향(〇〇行き/〇〇方面), 승강장, 갈아타는 역, 내릴 역과 출구, 소요시간과 요금(엔+원). get_directions 결과가 없으면 추정이라고 밝히고 앱의 '대중교통' 버튼(구글지도)으로 확인하라고 해.
- 막차·첫차, 운행 중단처럼 틀리면 곤란한 정보는 확인을 권해. 모르면 모른다고 해.
- 일정을 짜 달라고 하면 create_trip이나 add_to_trip으로 앱의 일정에 넣어. 예약했다고 하면 save_reservation으로 저장해.
- 영업시간은 바뀌었을 수 있어. 늦은 시간이면 닫았을 수 있다고 말해.
- Suica·ICOCA, 면세(같은 날 같은 가게 5,000엔 이상), 현금만 받는 가게 같은 여행 팁은 필요할 때만 한 줄로.
- 마크다운은 **굵게**, 목록, 링크만 써. 표는 쓰지 마.`;
}

export function cameraPrompt(question: string | null, lastSay: string): string {
  const d = places().dest;
  const goal = d ? `[목표] ${d.name}${d.nameLocal ? ` (${d.nameLocal})` : ''}까지 가는 길 안내` : '[목표] 목적지 없음. 사진 속 장소를 파악하고 질문에 답하기';
  const q = question || (d ? '지금 어느 쪽으로 가야 해?' : '여기가 어디고 뭘 보면 돼?');
  return `너는 일본을 여행 중인 한국인을 위한 실시간 길안내 AI야. 첨부 사진은 사용자가 지금 휴대폰 후면 카메라로 보고 있는 장면이야.

${contextBlock()}

${goal}
[질문] ${q}${lastSay ? `\n[직전 안내] ${lastSay}` : ''}

[규칙]
- 사진 속 표지판, 출구 번호(A3, 南口 등), 노선 색과 기호(예: 丸ノ内線 M), 층 표시(B1F, 2F), 화살표를 근거로 안내해.
- 방향은 카메라 화면 기준(왼쪽/오른쪽/정면/뒤돌아서, 계단·에스컬레이터 위/아래)으로 1~3단계만.
- 실내·지하에서는 GPS가 수십 m 틀려. 표지판을 GPS보다 우선해.
- 확신이 없으면 그렇다고 말하고, 무엇을 비춰야 할지 need에 적어 (예: "천장에 걸린 노란 표지판을 비춰줘").
- 일본어 표지판은 원문과 한국어 뜻을 signs에 넣어. 메뉴·안내문이면 핵심만 번역해.
- 출입 금지 구역이나 위험한 곳으로 안내하지 마.

JSON 하나만 출력: {"say":"소리로 읽을 한두 문장","steps":["짧은 단계"],"signs":[{"ja":"南口","ko":"남쪽 출구"}],"confidence":"high|medium|low","need":""}`;
}

export function liveInstructions(mode: 'voice' | 'turn' = 'voice'): string {
  const d = places().dest;
  return `너는 '길눈' 앱의 실시간 길안내 ${mode === 'voice' ? '음성 ' : ''}비서야. 사용자는 일본을 여행 중인 한국인이고, 휴대폰 후면 카메라로 보이는 장면을 너에게 보여주고 있어.
- 항상 한국어로 짧게 말해 (한두 문장). 사용자가 걷는 중이니 긴 설명은 하지 마.${mode === 'turn' ? ' 소리 내어 읽을 문장이니 마크다운·목록·이모지는 쓰지 마.' : ''}
- 화면의 표지판(出口, 南口, 番線, B1F 같은 층 표시, 노선 색·기호)을 읽고 화면 기준으로 왼쪽/오른쪽/정면/계단 위·아래로 안내해.
- 일본어 표지판은 원문을 그대로 읽어 준 다음 한국어 뜻을 말해.
- 위치·휴대폰 방향·목적지까지 거리가 필요하면 where_am_i 도구를 불러. 실내·지하에서는 GPS가 수십 m 틀리니 표지판을 더 믿어.
- 확신이 없으면 무엇을 비춰야 하는지 말해 (예: "천장에 걸린 노란 표지판을 비춰 주세요").
- 출입 금지 구역이나 위험한 곳으로 안내하지 마. 계단·에스컬레이터·횡단보도에서는 화면보다 주변을 보라고 말해.
- 목적지를 바꾸라고 하면 set_destination, 주변 시설은 search_places, 가는 법은 get_directions, 직원에게 보여줄 일본어는 show_to_staff를 써.
${d ? `- 현재 목적지: ${d.name}${d.nameLocal ? ` (${d.nameLocal})` : ''}` : '- 아직 목적지가 없어.'}`;
}

/** First turn of a live session: context, then let the AI greet and give the first hint. */
export function liveGreeting(): string {
  const d = places().dest;
  return `${contextBlock()}\n\n(앱 알림) 사용자가 방금 실시간 카메라 안내를 켰어. 화면에 보이는 것을 보고 한두 문장으로 짧게 인사하고 ${d ? '목적지 쪽으로 가는 첫 안내를 해 줘.' : '어디로 가는지, 무엇을 도와줄지 물어봐.'}`;
}

export function todayIso() {
  return isoDate(new Date());
}
export function jstHour() {
  return wallTime(new Date()).hour;
}
