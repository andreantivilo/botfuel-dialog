/* eslint-disable prefer-arrow-callback */

const expect = require('expect.js');
const BooleanExtractor = require('../../src/extractors/boolean_extractor');

const extractor = new BooleanExtractor({ locale: 'en' });

describe('BooleanExtractor', function () {
  it('should properly extract', async function () {
    const entities = await extractor.compute('I say yes you say no');
    expect(entities).to.eql([
      {
        dim: 'system:boolean',
        values: [
          {
            type: 'boolean',
            values: [false],
          },
        ],
      },
      {
        dim: 'system:boolean',
        values: [
          {
            type: 'boolean',
            values: [true],
          },
        ],
      },
    ]);
  });
});
