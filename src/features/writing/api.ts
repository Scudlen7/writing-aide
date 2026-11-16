import type {
  AiReview,
  Assignment,
  AssignmentListItem,
  Classroom,
  Identity,
  Submission,
  SubmissionSummary,
} from '@writing/writing'

export class RequestError extends Error {
  code: string
  status: number

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export async function request<T>(
  path: string,
  method = 'GET',
  data?: unknown
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok)
    throw new RequestError(response.status, payload?.code ?? 'default')
  return payload as T
}

export const session = () => request<Identity>('/api/me')

export interface DashboardData {
  classes: Classroom[]
  assignments: AssignmentListItem[]
}
export type AssignmentDetail = { assignment: Assignment } & (
  | { submissions: SubmissionSummary[] }
  | { submission: Submission | null; reviews: AiReview[]; aiEnabled: boolean }
)
export interface GradingDetail {
  assignment: Assignment
  submission: Submission & { studentName: string }
  reviews: AiReview[]
  aiEnabled: boolean
}
