// Verified exchange calendars, reviewed 2026-10-04. Dates use exchange local time.
// Refresh KR annually and review ad-hoc closures. Do not infer open sessions outside coverage.
// Sources: https://www.nyse.com/markets/hours-calendars
// KRX: https://kind.krx.co.kr/external/dst/reference/11625/2026%20%EC%BD%94%EC%8A%A4%EB%8B%A5%EC%8B%9C%EC%9E%A5%20%EA%B3%B5%EC%8B%9C%EC%9D%BC%EC%A0%95%20%EC%BA%98%EB%A6%B0%EB%8D%94_vF.pdf
// Election / Constitution Day: https://kind.krx.co.kr/external/2026/05/20/000110/20260520000197/32154.htm
export const MARKET_CALENDAR_COVERAGE = { KR: [2026], US: [2026, 2027, 2028] } as const
export const MARKET_SCHEDULE_REVIEWED_AT = '2026-10-04'
export const MARKET_SCHEDULE_SOURCES = {
  KR: 'https://www.krx.co.kr/contents/MKD/01/0110/01100305/MKD01100305.jsp',
  US: 'https://www.nyse.com/markets/hours-calendars',
} as const

export const KR_HOLIDAYS: Readonly<Record<string, string>> = {
  '2026-01-01': '신정',
  '2026-02-16': '설 연휴', '2026-02-17': '설날', '2026-02-18': '설 연휴',
  '2026-03-02': '삼일절 대체휴일',
  '2026-05-01': '노동절', '2026-05-05': '어린이날', '2026-05-25': '부처님오신날 대체휴일',
  '2026-06-03': '지방선거', '2026-07-17': '제헌절', '2026-08-17': '광복절 대체휴일',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석',
  '2026-10-05': '개천절 대체휴일', '2026-10-09': '한글날',
  '2026-12-25': '성탄절', '2026-12-31': '연말 휴장',
}
export const US_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
  '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19',
  '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25',
])
export const US_EARLY_CLOSES = new Set([
  '2026-11-27', '2026-12-24', '2027-11-26', '2028-07-03', '2028-11-24',
])
// Special session hours must be confirmed by KRX. CSAT date alone does not establish hours.
// https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=100526&m=020402&s=moe
export const KR_HOURS_PENDING = new Set(['2026-01-02', '2026-11-19'])
