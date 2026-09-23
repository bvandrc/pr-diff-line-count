import { bold, italic, td, th, tr, unbreakable } from '../index'

describe('unbreakable', () => {
  it('replaces every space, so the phrase cannot wrap', () => {
    expect(unbreakable('GitHub reports +1 / −2')).toBe(
      'GitHub&nbsp;reports&nbsp;+1&nbsp;/&nbsp;−2'
    )
  })

  it('leaves text with nowhere to break alone', () => {
    expect(unbreakable('Total')).toBe('Total')
  })
})

describe('bold', () => {
  it('wraps content the way the comment renderer spells emphasis', () => {
    expect(bold('Total')).toBe('<strong>Total</strong>')
  })

  it('takes a number as readily as a string', () => {
    expect(bold(42)).toBe('<strong>42</strong>')
  })
})

describe('italic', () => {
  it('wraps content in an em', () => {
    expect(italic('GitHub reports')).toBe('<em>GitHub reports</em>')
  })
})

describe('td', () => {
  it('renders a plain cell when given no attributes', () => {
    expect(td(12)).toBe('<td>12</td>')
  })

  it('renders each attribute it is given, in the order they were written', () => {
    expect(td('Total', { colspan: 6, align: 'center' })).toBe(
      '<td colspan="6" align="center">Total</td>'
    )
  })
})

describe('th', () => {
  it('renders a header cell, with the same attributes a td takes', () => {
    expect(th('code', { colspan: 3, align: 'center' })).toBe(
      '<th colspan="3" align="center">code</th>'
    )
  })
})

describe('tr', () => {
  it('wraps cells that were already built', () => {
    expect(tr(td(1) + td(2))).toBe('<tr><td>1</td><td>2</td></tr>')
  })
})
