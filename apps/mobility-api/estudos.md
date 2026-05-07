## Decorators

Sem o uso do @, o nest.js ignora ou simplesmente vê como uma classe ou uma função normal, mas quando usamos o @, ele entende e passa a enxergar aquilo. É como um rótulo, que diz a ele o que aquele método ou função faz e ele passa a reconhecê-lo. 

## Sobre o export usado nos arquivos 

```javascript
export class UsuariosController 
```

export = significa que além de criarmos a classe UsuariosController, ela poderá ser acessada por outros arquivos. 

## constructor

```typescript
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}
}
  ```

  - @Controller: indica que vamos estabelecer a classe controller que se refere a 'usuarios'
  - constructor é uma função que é chamada assim que a classe é criada para resolver qualquer tipo de dependencia que essa classe venha a ter. Como o nest.js que vai trazer essa dependencia, chamamos de injeção de dependencia
  - private readonly porque vai ser usado só aqui e não pode ser editado. 
  - o nome da classe que vamos chamar como dependencia é usuariosService e é do tipo UsuariosService.

  ## A forma que utilizamos o metodo Post

  aqui utilizamos o post assim: 

  ```typescript
   @Post()
   ```
   não passamos a rota pra ele porque já a definimos antes na controller. 

   ## Get da nossa usuario controller

   Veja o seguinte trecho de codigo:

   ```typescript
    @Get(':id')
  async buscarPorId(@Param('id') id: string) {
    return this.usuariosService.buscarPorId(Number(id));
  }
  ```
 - :id (significa que é um valor dinâmico)
 - 'id' é a variável onde nos vamos jogar o valor real do nosso id que vem como uma string pois é dessa forma que o nest.js reconhece uma url.
 - Depois a gente converte esse valor pra numero com o Number. 