class Extractor1 {
  compute(sentence) {
    return [
      {
        dim: 'dim1',
        body: sentence,
        values: [
          {
            value: sentence,
            type: 'string',
          },
        ],
      },
    ];
  }

}

module.exports = Extractor1;
