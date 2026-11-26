const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'static', 'js', 'scripture-popup.js'), 'utf8');
const testScript = script.replace(/\}\)\(\);\s*$/, `
    window.popupTest = { expandRanges, parseAndExpandRefs, renderVerseList };
})();`);
assert.notEqual(testScript, script);

function popup(book = '创') {
    const dict = {
        [book + '1:1']: '第一节',
        [book + '1:2上']: '第二节上半',
        [book + '1:2下']: '第二节下半',
        [book + '1:3']: '第三节',
        [book + '2:1']: '第二章第一节',
        [book + '2:2']: '第二章第二节',
        [book + '2:3']: '第二章第三节'
    };
    const context = {
        window: { CX_SCRIPTURES_DATA: dict, CX_BOOK_INDEX: { [book]: 1 } },
        document: { readyState: 'loading', addEventListener() {} }
    };
    vm.runInNewContext(testScript, context);
    return { api: context.window.popupTest, dict };
}

test('string fallback expands repeated endpoint books and preserves half-verse boundaries', () => {
    const { api, dict } = popup();
    const cases = [
        {
            ref: '创1:2下-创2:3',
            range: '1,1,2,2,1,2,3,0',
            expected: ['创1:2下', '创1:3', '创2:1', '创2:2', '创2:3']
        },
        {
            ref: '创1:1-创1:2上',
            range: '1,1,1,0,1,1,2,1',
            expected: ['创1:1', '创1:2上']
        },
        {
            ref: '创1:2下-创1:3',
            range: '1,1,2,2,1,1,3,0',
            expected: ['创1:2下', '创1:3']
        }
    ];
    for (const { ref, range, expected } of cases) {
        assert.deepEqual(Array.from(api.expandRanges(range)), expected, ref);
        assert.deepEqual(Array.from(api.parseAndExpandRefs(ref, dict, '')), expected, ref);
        const html = api.renderVerseList(ref, '', null, null);
        assert.equal(html.includes('scripture-popup-verse--missing'), false, ref);
        assert.equal((html.match(/class="scripture-popup-verse"/g) || []).length, expected.length, ref);
    }
});

test('traditional book names use the same half-verse fallback boundaries', () => {
    for (const book of ['創', '詩', '約壹', '彼後']) {
        const { api, dict } = popup(book);
        const ref = book + '1:2下-' + book + '2:3';
        const expected = ['1:2下', '1:3', '2:1', '2:2', '2:3'].map(tail => book + tail);
        assert.deepEqual(Array.from(api.parseAndExpandRefs(ref, dict, '')), expected, book);
        assert.equal(api.renderVerseList(ref, '', null, null).includes('scripture-popup-verse--missing'), false, book);
    }
});

test('single half references only trim real split verses and preserve unsplit text', () => {
    const { api } = popup();
    assert.deepEqual(Array.from(api.expandRanges('1,1,2,1')), ['创1:2上']);
    assert.deepEqual(Array.from(api.expandRanges('1,1,2,2')), ['创1:2下']);
    assert.deepEqual(Array.from(api.expandRanges('1,1,1,1')), ['创1:1']);
    assert.deepEqual(Array.from(api.expandRanges('1,1,1,2')), ['创1:1']);
    assert.ok(api.renderVerseList('创1:1下', '', null, null).includes('第一节'));
});
