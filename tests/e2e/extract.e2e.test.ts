import { submitRequest, pollOperation, createDummyPdfBlob } from './utils';

describe('Extract API Endpoint', () => {

  const standardModes = ['invoice', 'contract', 'id-card', 'receipt', 'table'];

  for (const mode of standardModes) {
    it(`should extract data using mode = ${mode}`, async () => {
      const formData = new FormData();
      formData.append('type', mode);
      formData.append('file', createDummyPdfBlob(), 'document.pdf');
      
      const res = await submitRequest('/extract', formData);
      expect(res.status).toBe(202);
      
      const resData = await res.json();
      const operationId = resData.name.split('/')[1];
      const finalState = await pollOperation(operationId);
      
      expect(finalState.done).toBe(true);
      expect(finalState.metadata.state).toBe('SUCCEEDED');
      expect(finalState.result.output_format).toBe('json');
    });
  }

  it('should extract data using custom json schema mode', async () => {
    const formData = new FormData();
    formData.append('type', 'custom');
    formData.append('file', createDummyPdfBlob(), 'document.pdf');
    
    // Custom mode requires a schema
    const customSchema = {
      type: 'object',
      properties: {
        companyName: { type: 'string' },
        totalAmount: { type: 'number' }
      },
      required: ['companyName']
    };
    formData.append('schema', JSON.stringify(customSchema));
    
    const res = await submitRequest('/extract', formData);
    expect(res.status).toBe(202);
    
    const resData = await res.json();
    const operationId = resData.name.split('/')[1];
    const finalState = await pollOperation(operationId);
    
    expect(finalState.done).toBe(true);
    expect(finalState.metadata.state).toBe('SUCCEEDED');
  });

});
