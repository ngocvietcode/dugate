import { submitRequest, pollOperation, createDummyPdfBlob, createDummyDocxBlob } from './utils';

describe('Compare API Endpoint', () => {

  const standardModes = ['diff', 'semantic', 'version'];

  for (const mode of standardModes) {
    it(`should successfully compare documents using mode = ${mode}`, async () => {
      const formData = new FormData();
      formData.append('mode', mode);
      formData.append('files[]', createDummyPdfBlob(), 'document1.pdf');
      formData.append('files[]', createDummyDocxBlob(), 'document2.docx');
      
      const res = await submitRequest('/compare', formData);
      expect(res.status).toBe(202);
      
      const resData = await res.json();
      const operationId = resData.name.split('/')[1];
      const finalState = await pollOperation(operationId);
      
      expect(finalState.done).toBe(true);
      expect(finalState.metadata.state).toBe('SUCCEEDED');
      expect(finalState.result.output_format).toBe('json');
    });
  }

});
