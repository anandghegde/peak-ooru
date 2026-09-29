import { connect as plain, type Socket } from 'node:net'
import { connect as secure, type TLSSocket } from 'node:tls'

/*
 * Just enough SMTP to send one message: implicit TLS on port 465, or STARTTLS (required) on any other port, with
 * AUTH PLAIN when a user is set. Written here rather than taken from a package, since it is all the server sends.
 */

export interface Smtp {
  host: string
  port: number
  user?: string
  pass?: string
  from: string
  /** For tests against a stand-in server on this machine: send without TLS. Never set in production. */
  insecure?: boolean
}

export interface Mail {
  to: string
  subject: string
  text: string
}

class Talk {
  private buffer = ''
  private waiters: ((line: string) => void)[] = []
  private lines: string[] = []

  constructor(public socket: Socket | TLSSocket) {
    this.listen()
  }

  listen(): void {
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk
      let i
      while ((i = this.buffer.indexOf('\r\n')) >= 0) {
        const line = this.buffer.slice(0, i)
        this.buffer = this.buffer.slice(i + 2)
        // A reply of several lines ends with the line whose code is followed by a space.
        this.lines.push(line)
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const whole = this.lines.join('\n')
          this.lines = []
          this.waiters.shift()?.(whole)
        }
      }
    })
  }

  reply(): Promise<string> {
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  async say(line: string | null, expect: number): Promise<string> {
    const answer = this.reply()
    if (line !== null) this.socket.write(`${line}\r\n`)
    const got = await answer
    if (!got.startsWith(String(expect))) throw new Error(`The mail server answered: ${got.split('\n').at(-1)}`)
    return got
  }
}

const header = (s: string) => s.replace(/[\r\n]+/g, ' ')

/** Sends one plain-text message. Rejects on any refusal, or after 20 seconds. */
export async function send(smtp: Smtp, mail: Mail): Promise<void> {
  const tls = smtp.port === 465 && !smtp.insecure
  const socket: Socket | TLSSocket = tls ? secure({ host: smtp.host, port: smtp.port, servername: smtp.host }) : plain({ host: smtp.host, port: smtp.port })
  socket.setTimeout(20_000, () => socket.destroy(new Error('The mail server did not answer in time.')))
  const failed = new Promise<never>((_, reject) => socket.on('error', reject))
  const talk = async () => {
    let t = new Talk(socket)
    await t.say(null, 220)
    let ehlo = await t.say(`EHLO peakooru`, 250)
    if (!tls && !smtp.insecure) {
      if (!/STARTTLS/i.test(ehlo)) throw new Error('The mail server does not offer STARTTLS.')
      await t.say('STARTTLS', 220)
      socket.removeAllListeners('data')
      const upgraded = secure({ socket, servername: smtp.host })
      upgraded.on('error', () => {})
      await new Promise<void>((resolve, reject) => {
        upgraded.once('secureConnect', resolve)
        upgraded.once('error', reject)
      })
      t = new Talk(upgraded)
      ehlo = await t.say('EHLO peakooru', 250)
    }
    if (smtp.user) await t.say(`AUTH PLAIN ${Buffer.from(`\0${smtp.user}\0${smtp.pass ?? ''}`).toString('base64')}`, 235)
    await t.say(`MAIL FROM:<${header(smtp.from).replace(/.*<|>.*/g, '')}>`, 250)
    await t.say(`RCPT TO:<${header(mail.to)}>`, 250)
    await t.say('DATA', 354)
    const body = [
      `From: ${header(smtp.from)}`,
      `To: ${header(mail.to)}`,
      `Subject: ${header(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      ...mail.text.split(/\r?\n/).map((l) => (l.startsWith('.') ? `.${l}` : l)),
      '.',
    ].join('\r\n')
    await t.say(body, 250)
    await t.say('QUIT', 221).catch(() => {})
    t.socket.end()
  }
  try {
    await Promise.race([talk(), failed])
  } finally {
    socket.destroy()
  }
}
